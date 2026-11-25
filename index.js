/**
 * DeepSeek Harness Host plugin: Gemini API Flex (and Standard / Priority) service tier injection.
 *
 * How it works:
 * 1. Listens synchronously to `llm-pi-ai/request-headers` to match exact provider/model routes
 *    (supporting both the built-in `google` route and custom Gemini Developer API relay routes).
 *    When matched, attaches internal process-local marker headers and optional `X-Server-Timeout`.
 * 2. Wraps `globalThis.fetch` inside `ctx.effect` (cleanly restored on unload). When a request
 *    carries the internal marker header, the wrapper strips all internal headers immediately and,
 *    for POST `:generateContent` / `:streamGenerateContent` requests, injects top-level
 *    `serviceTier` into the JSON body (matching `@google/genai`'s `generateContentConfigToMldev`).
 * 3. Observes the `x-gemini-service-tier` response header (without consuming the response body)
 *    for diagnostics via `/gemini-flex` and the `gemini_service_tier` tool.
 */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'gemini-flex'

export const VALID_TIERS = ['off', 'flex', 'standard', 'priority']
export const INTERNAL_TIER_HEADER = 'x-dsh-gemini-flex-tier'
export const INTERNAL_META_HEADER = 'x-dsh-gemini-flex-meta'
const DEFAULT_GEMINI_HOST = 'generativelanguage.googleapis.com'
const GENERATE_ENDPOINT_RE = /:(?:generateContent|streamGenerateContent)(?:$|[/?#])/i

async function loadSchemastery() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    return mod.default ?? mod
  } catch {
    const searchPaths = []
    if (process.env.DSH_INSTALL_DIR) {
      searchPaths.push(process.env.DSH_INSTALL_DIR)
    }
    if (process.argv[1]) {
      searchPaths.push(dirname(process.argv[1]))
      try {
        searchPaths.push(dirname(realpathSync(process.argv[1])))
      } catch {
        // Ignore broken argv[1] symlink
      }
    }
    if (process.execPath) {
      searchPaths.push(dirname(process.execPath))
    }
    searchPaths.push(process.cwd())

    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('@deepseek-ai/schemastery/package.json', { paths: searchPaths })
    const mjsPath = join(dirname(pkgPath), 'lib', 'index.mjs')
    const mod = await import(pathToFileURL(mjsPath).href)
    return mod.default ?? mod
  }
}

const z = await loadSchemastery()

export const Config = z.object({
  serviceTier: z.union([
    z.const('off'),
    z.const('flex'),
    z.const('standard'),
    z.const('priority'),
  ]).default('flex').volatile(),
  serverTimeoutSec: z.number().min(0).max(3600).step(1).default(600).volatile(),
  providers: z.array(z.string()).default(['google']).volatile(),
  modelPatterns: z.array(z.string()).default([]).volatile(),
  extraHosts: z.array(z.string()).default([]).volatile(),
  debugLog: z.boolean().default(false).volatile(),
})

/** Read a volatile config reference or plain value safely. */
export function readVolatile(ref, fallback) {
  if (ref && typeof ref === 'object' && typeof ref.get === 'function') {
    const value = ref.get()
    return value === undefined ? fallback : value
  }
  return ref === undefined ? fallback : ref
}

/** Normalize a list of strings (trimmed, non-empty, deduplicated). */
export function normalizeStringList(items) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const out = []
  for (const raw of items) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** Case-insensitive glob/wildcard matcher supporting `*`. */
export function matchesWildcard(value, pattern) {
  if (typeof value !== 'string' || typeof pattern !== 'string') return false
  const needle = pattern.trim().toLowerCase()
  if (!needle) return false
  const hay = value.trim().toLowerCase()
  if (needle === '*') return true
  if (!needle.includes('*')) return hay === needle
  const escaped = needle.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(hay)
}

/** Match a hostname against exact domain or `*.example.com` wildcard. */
export function matchesHost(hostname, pattern) {
  if (!hostname || !pattern) return false
  const host = hostname.trim().toLowerCase()
  const pat = pattern.trim().toLowerCase()
  if (!pat) return false
  if (pat.startsWith('*.')) {
    const suffix = pat.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === pat
}

/** Safely extract hostname from a URL string. */
export function extractHostname(urlString) {
  if (typeof urlString !== 'string' || !urlString) return ''
  try {
    return new URL(urlString).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Decide whether a `llm-pi-ai/request-headers` request should receive a Gemini service tier. */
export function shouldApplyToRequest(request, snapshot) {
  if (!request || !snapshot) return false
  if (snapshot.serviceTier === 'off') return false

  const providers = normalizeStringList(snapshot.providers)
  const extraHosts = normalizeStringList(snapshot.extraHosts)
  const hostname = extractHostname(request.baseURL)

  const providerMatched = providers.length > 0
    ? providers.some(pattern => matchesWildcard(request.provider ?? '', pattern))
    : (matchesHost(hostname, DEFAULT_GEMINI_HOST) || extraHosts.some(hostPat => matchesHost(hostname, hostPat)))

  const extraHostMatched = extraHosts.length > 0 && extraHosts.some(hostPat => matchesHost(hostname, hostPat))

  if (!providerMatched && !extraHostMatched) return false

  const modelPatterns = normalizeStringList(snapshot.modelPatterns)
  if (modelPatterns.length > 0) {
    const model = request.model ?? ''
    const matchedModel = modelPatterns.some((pattern) => {
      if (pattern.includes('*')) return matchesWildcard(model, pattern)
      return model.toLowerCase().includes(pattern.toLowerCase())
    })
    if (!matchedModel) return false
  }

  return true
}

/** Return true only for Gemini `:generateContent` and `:streamGenerateContent` URLs. */
export function isGenerateContentUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false
  try {
    const parsed = new URL(urlString)
    return GENERATE_ENDPOINT_RE.test(parsed.pathname)
  } catch {
    return GENERATE_ENDPOINT_RE.test(urlString)
  }
}

/** Decode a fetch body payload into UTF-8 string when possible. */
function decodeBodyText(body) {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  return null
}

/** Inject top-level `serviceTier` into a JSON request body string. */
export function injectServiceTierIntoBody(body, tier) {
  const text = decodeBodyText(body)
  if (text === null) return { changed: false, body }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { changed: false, body }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { changed: false, body }
  }
  if (parsed.serviceTier === tier) {
    return { changed: false, body: text }
  }
  parsed.serviceTier = tier
  return { changed: true, body: JSON.stringify(parsed) }
}

/** Extract URL string from fetch `input`. */
function resolveRequestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url
  return ''
}

/** Extract uppercase HTTP method from fetch `input` and `init`. */
function resolveRequestMethod(input, init) {
  if (init && typeof init.method === 'string') return init.method.toUpperCase()
  if (input && typeof input === 'object' && typeof input.method === 'string') return input.method.toUpperCase()
  return 'GET'
}

/** Fast-path header lookup before allocating a full `Headers` instance. */
function hasInternalMarker(input, init) {
  const checkHeaders = (hdrs) => {
    if (!hdrs) return false
    if (hdrs instanceof Headers) {
      return hdrs.has(INTERNAL_TIER_HEADER) || hdrs.has(INTERNAL_META_HEADER)
    }
    if (Array.isArray(hdrs)) {
      return hdrs.some(([k]) => {
        const lower = String(k).toLowerCase()
        return lower === INTERNAL_TIER_HEADER || lower === INTERNAL_META_HEADER
      })
    }
    if (typeof hdrs === 'object') {
      for (const key of Object.keys(hdrs)) {
        const lower = key.toLowerCase()
        if (lower === INTERNAL_TIER_HEADER || lower === INTERNAL_META_HEADER) return true
      }
    }
    return false
  }
  return checkHeaders(init?.headers) || (input && typeof input === 'object' && checkHeaders(input.headers))
}

/**
 * Create a scoped fetch wrapper that strips internal marker headers and injects
 * `serviceTier` on matched Gemini generateContent POST requests.
 */
export function createFetchWrapper(originalFetch, hooks = {}) {
  let active = true

  const wrappedFetch = async function geminiFlexFetch(input, init) {
    if (!active || !hasInternalMarker(input, init)) {
      return originalFetch.call(this, input, init)
    }

    const isRequestObj = typeof Request !== 'undefined' && input instanceof Request
    const mergedHeaders = new Headers(isRequestObj ? input.headers : undefined)
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        mergedHeaders.set(key, value)
      })
    }

    const tier = (mergedHeaders.get(INTERNAL_TIER_HEADER) ?? '').trim().toLowerCase()
    const meta = mergedHeaders.get(INTERNAL_META_HEADER) ?? ''
    mergedHeaders.delete(INTERNAL_TIER_HEADER)
    mergedHeaders.delete(INTERNAL_META_HEADER)

    const url = resolveRequestUrl(input)
    const method = resolveRequestMethod(input, init)
    const shouldMutate = (tier === 'flex' || tier === 'standard' || tier === 'priority')
      && method === 'POST'
      && isGenerateContentUrl(url)

    let nextInput = input
    let nextInit = { ...(init ?? {}), headers: mergedHeaders }
    let injected = false

    if (shouldMutate) {
      let rawBody = init?.body
      if (rawBody === undefined && isRequestObj) {
        try {
          rawBody = await input.clone().text()
        } catch {
          rawBody = undefined
        }
      }
      if (rawBody !== undefined && rawBody !== null) {
        const result = injectServiceTierIntoBody(rawBody, tier)
        if (result.changed) {
          injected = true
          nextInit.body = result.body
          mergedHeaders.delete('content-length')
        }
      }
    }

    if (isRequestObj) {
      // Rebuild Request without internal headers (and with mutated body when applicable).
      nextInput = new Request(input, nextInit)
      nextInit = undefined
    }

    const response = await originalFetch.call(this, nextInput, nextInit)

    if (shouldMutate && typeof hooks.onResponse === 'function') {
      try {
        hooks.onResponse({
          timestamp: new Date().toISOString(),
          route: meta || undefined,
          endpoint: url.split('?')[0],
          requestedTier: tier,
          injected,
          appliedTier: response?.headers?.get?.('x-gemini-service-tier') ?? null,
          status: response?.status ?? null,
        })
      } catch {
        // Diagnostics must never break inference responses.
      }
    }

    return response
  }

  return {
    wrappedFetch,
    dispose() {
      active = false
    },
  }
}

/** Read the full live configuration snapshot from volatile config refs. */
function readConfigSnapshot(config) {
  return {
    serviceTier: readVolatile(config?.serviceTier, 'flex'),
    serverTimeoutSec: Number(readVolatile(config?.serverTimeoutSec, 600)) || 0,
    providers: normalizeStringList(readVolatile(config?.providers, ['google'])),
    modelPatterns: normalizeStringList(readVolatile(config?.modelPatterns, [])),
    extraHosts: normalizeStringList(readVolatile(config?.extraHosts, [])),
    debugLog: Boolean(readVolatile(config?.debugLog, false)),
  }
}

/** Validate and normalize a partial config update before persisting. */
function validateConfigPatch(input) {
  const patch = {}
  if (input.serviceTier !== undefined) {
    const tier = String(input.serviceTier).trim().toLowerCase()
    if (!VALID_TIERS.includes(tier)) {
      throw new Error(`Invalid serviceTier "${input.serviceTier}". Allowed values: ${VALID_TIERS.join(', ')}`)
    }
    patch.serviceTier = tier
  }
  if (input.serverTimeoutSec !== undefined) {
    const sec = Number(input.serverTimeoutSec)
    if (!Number.isInteger(sec) || sec < 0 || sec > 3600) {
      throw new Error('serverTimeoutSec must be an integer between 0 and 3600')
    }
    patch.serverTimeoutSec = sec
  }
  if (input.providers !== undefined) {
    if (!Array.isArray(input.providers)) throw new Error('providers must be an array of strings')
    patch.providers = normalizeStringList(input.providers)
  }
  if (input.modelPatterns !== undefined) {
    if (!Array.isArray(input.modelPatterns)) throw new Error('modelPatterns must be an array of strings')
    patch.modelPatterns = normalizeStringList(input.modelPatterns)
  }
  if (input.extraHosts !== undefined) {
    if (!Array.isArray(input.extraHosts)) throw new Error('extraHosts must be an array of strings')
    patch.extraHosts = normalizeStringList(input.extraHosts)
  }
  if (input.debugLog !== undefined) {
    if (typeof input.debugLog !== 'boolean') throw new Error('debugLog must be a boolean')
    patch.debugLog = input.debugLog
  }
  return patch
}

function formatStatusText(snapshot, lastObserved) {
  const lines = [
    `Gemini service tier: ${snapshot.serviceTier}`,
    `X-Server-Timeout: ${snapshot.serverTimeoutSec > 0 ? `${snapshot.serverTimeoutSec}s` : 'disabled'}`,
    `Target providers: ${snapshot.providers.length > 0 ? snapshot.providers.join(', ') : '(auto: Gemini official / extraHosts)'}`,
    `Model filters: ${snapshot.modelPatterns.length > 0 ? snapshot.modelPatterns.join(', ') : '(all models)'}`,
  ]
  if (snapshot.extraHosts.length > 0) {
    lines.push(`Extra hosts: ${snapshot.extraHosts.join(', ')}`)
  }
  if (lastObserved) {
    const applied = lastObserved.appliedTier ?? '(header not returned)'
    lines.push(
      `Last observed request: ${lastObserved.route ?? lastObserved.endpoint}`
      + ` | requested=${lastObserved.requestedTier}`
      + ` | x-gemini-service-tier=${applied}`
      + ` | HTTP ${lastObserved.status ?? '?'} @ ${lastObserved.timestamp}`,
    )
  } else {
    lines.push('Last observed request: none yet in this process')
  }
  return lines.join('\n')
}

export function apply(ctx, config) {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  let lastObserved = null

  // Custom UI lives in Settings > Models and the Composer model selector.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // Shared persistence helper used by both `/gemini-flex` and the `gemini_service_tier` tool.
  const persistPatch = async (rawPatch) => {
    const patch = validateConfigPatch(rawPatch)
    if (Object.keys(patch).length === 0) {
      return readConfigSnapshot(config)
    }
    const settings = ctx.get('settings')
    if (settings) {
      await settings.update(settingsNs, patch)
      return readConfigSnapshot(config)
    }
    const entry = ctx.fiber.entry
    const editor = ctx.get('configEditor')
    if (entry !== undefined && editor !== undefined) {
      await editor.edit(entry, current => ({ ...current, ...patch }))
      return readConfigSnapshot(config)
    }
    throw new Error('Configuration cannot be saved in this profile (neither settings nor configEditor is mounted)')
  }

  // 1. Mark matched `llm-pi-ai` requests synchronously in the header waterfall.
  ctx.on('llm-pi-ai/request-headers', (request, headers, next) => {
    try {
      const snapshot = readConfigSnapshot(config)
      if (shouldApplyToRequest(request, snapshot)) {
        headers.set(INTERNAL_TIER_HEADER, snapshot.serviceTier)
        headers.set(INTERNAL_META_HEADER, `${request.provider}/${request.model}`)
        if (snapshot.serverTimeoutSec > 0 && !headers.has('x-server-timeout')) {
          headers.set('X-Server-Timeout', String(snapshot.serverTimeoutSec))
        }
      }
    } catch (error) {
      ctx.logger?.warn?.('[gemini-flex] failed while evaluating request headers:', error)
    }
    return next()
  })

  // 2. Wrap globalThis.fetch to strip internal markers and inject top-level `serviceTier`.
  ctx.effect(() => {
    const originalFetch = globalThis.fetch
    if (typeof originalFetch !== 'function') return undefined

    const { wrappedFetch, dispose } = createFetchWrapper(originalFetch, {
      onResponse: (record) => {
        lastObserved = record
        const snapshot = readConfigSnapshot(config)
        if (snapshot.debugLog) {
          ctx.logger?.info?.(
            `[gemini-flex] ${record.route ?? record.endpoint} requested=${record.requestedTier}`
            + ` injected=${record.injected} applied=${record.appliedTier ?? 'n/a'} status=${record.status ?? 'n/a'}`,
          )
        }
      },
    })

    globalThis.fetch = wrappedFetch
    return () => {
      dispose()
      if (globalThis.fetch === wrappedFetch) {
        globalThis.fetch = originalFetch
      }
    }
  }, 'gemini-flex: fetch wrapper')

  // 3. Register `/gemini-flex` slash command when commands service is present.
  ctx.inject(['commands'], (child) => {
    child.effect(() => child.commands.register({
      name: 'gemini-flex',
      description: 'Inspect or switch Gemini API service tier (off | flex | standard | priority) and X-Server-Timeout.',
      input: {
        hint: '[status | flex | standard | priority | off | timeout <seconds>]',
      },
      handler: async (invocation) => {
        const raw = (invocation.rawInput ?? '').trim()
        const parts = raw ? raw.split(/\s+/) : []
        const sub = (parts[0] ?? 'status').toLowerCase()

        try {
          if (sub === 'status') {
            return { kind: 'success', text: formatStatusText(readConfigSnapshot(config), lastObserved) }
          }
          if (VALID_TIERS.includes(sub)) {
            const next = await persistPatch({ serviceTier: sub })
            return {
              kind: 'success',
              text: `Gemini service tier updated to "${next.serviceTier}".\n${formatStatusText(next, lastObserved)}`,
            }
          }
          if (sub === 'timeout') {
            if (parts[1] === undefined) {
              return { kind: 'error', text: 'Usage: /gemini-flex timeout <0-3600>' }
            }
            const sec = Number(parts[1])
            const next = await persistPatch({ serverTimeoutSec: sec })
            return {
              kind: 'success',
              text: `X-Server-Timeout updated to ${next.serverTimeoutSec > 0 ? `${next.serverTimeoutSec}s` : 'disabled'}.`,
            }
          }
          return {
            kind: 'error',
            text: `Unknown argument "${parts[0]}". Usage: /gemini-flex [status | flex | standard | priority | off | timeout <seconds>]`,
          }
        } catch (error) {
          return {
            kind: 'error',
            text: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }), 'gemini-flex: slash command')
  })

  // 4. Register `gemini_service_tier` agent tool sharing the exact same Host operation.
  ctx.inject(['tools'], (child) => {
    child.effect(() => child.tools.register({
      name: 'gemini_service_tier',
      description: 'Inspect or update the Gemini API service tier plugin (off, flex, standard, priority), X-Server-Timeout, target providers, and last observed x-gemini-service-tier header.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'set'],
            description: 'Read current status and last observed response tier, or update configuration.',
          },
          service_tier: {
            type: 'string',
            enum: VALID_TIERS,
            description: 'Gemini service tier to inject: flex (~50% lower cost), standard, priority, or off.',
          },
          server_timeout_sec: {
            type: 'integer',
            minimum: 0,
            maximum: 3600,
            description: 'Optional X-Server-Timeout header in seconds (0 disables the header).',
          },
          providers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Provider route IDs (supports `*` wildcards) that should receive Gemini serviceTier.',
          },
          model_patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional model substrings or `*` wildcards; empty matches all models on target providers.',
          },
          extra_hosts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional extra Gemini-compatible relay hostnames (exact or `*.domain`).',
          },
          debug_log: {
            type: 'boolean',
            description: 'Enable Host debug logging for injected requests and x-gemini-service-tier headers.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                serviceTier: { type: 'string' },
                serverTimeoutSec: { type: 'integer' },
                providers: { type: 'array', items: { type: 'string' } },
                modelPatterns: { type: 'array', items: { type: 'string' } },
                extraHosts: { type: 'array', items: { type: 'string' } },
                debugLog: { type: 'boolean' },
              },
              required: ['serviceTier', 'serverTimeoutSec', 'providers', 'modelPatterns', 'extraHosts', 'debugLog'],
            },
            lastObserved: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string' },
                    route: { type: 'string' },
                    endpoint: { type: 'string' },
                    requestedTier: { type: 'string' },
                    injected: { type: 'boolean' },
                    appliedTier: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    status: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
                  },
                },
              ],
            },
          },
          required: ['config', 'lastObserved'],
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: formatStatusText(value.config, value.lastObserved),
          }]
        },
      },
      isConcurrencySafe(args) {
        return args?.action === 'status'
      },
      async execute(args) {
        const action = args?.action
        if (action === 'status') {
          return {
            config: readConfigSnapshot(config),
            lastObserved,
          }
        }
        if (action === 'set') {
          const next = await persistPatch({
            serviceTier: args.service_tier,
            serverTimeoutSec: args.server_timeout_sec,
            providers: args.providers,
            modelPatterns: args.model_patterns,
            extraHosts: args.extra_hosts,
            debugLog: args.debug_log,
          })
          return {
            config: next,
            lastObserved,
          }
        }
        throw new Error(`Unsupported action "${String(action)}". Use "status" or "set".`)
      },
    }), 'gemini-flex: agent tool')
  })
}
