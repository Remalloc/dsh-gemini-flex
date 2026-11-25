/**
 * DeepSeek Harness Client plugin for @local/dsh-gemini-flex.
 *
 * Contributes:
 * 1. `conversation.input.model.options` — quick Gemini service tier selector inside the composer
 *    Model dropdown menu (right alongside Agent Teams).
 * 2. `settings.models.footer` — full Gemini Flex configuration card in Settings > Models
 *    (service tier, X-Server-Timeout, target providers, optional model wildcards, debug log).
 *
 * Persists live through `ctx.remote.settings` without restarting the Host plugin.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-gemini-flex',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useId, useRef, useState, useSyncExternalStore } = React

    const NS = 'gemini-flex'
    const STYLE_ID = 'dsh-gemini-flex-styles'
    const TIERS = ['off', 'flex', 'standard', 'priority']
    const TIMEOUT_PRESETS = [0, 300, 600, 900]

    const DICT_EN = {
      'menu.label': 'Gemini tier',
      'menu.tier.off': 'Off',
      'menu.tier.flex': 'Flex',
      'menu.tier.standard': 'Std',
      'menu.tier.priority': 'Prio',
      'menu.tip.matched': 'Profile-wide setting — applies to current model ({provider}/{model}).',
      'menu.tip.unmatched': 'Profile-wide setting — applies to configured Gemini routes ({providers}).',
      'menu.tip.auto': 'Profile-wide setting — applies automatically to Gemini official & extra relay hosts.',
      'menu.tip.readonly': 'Profile settings are read-only in this environment.',
      'menu.tip.loading': 'Loading Gemini Flex settings…',
      'menu.failed': 'Failed to update Gemini tier: {message}',
      'card.title': 'Gemini Flex tier',
      'card.subtitle': 'Profile-wide setting: injects top-level serviceTier and optional X-Server-Timeout on matched Gemini Developer API routes across sessions.',
      'card.badge.off': 'Off',
      'card.badge.flex': 'Flex · -50%',
      'card.badge.standard': 'Standard',
      'card.badge.priority': 'Priority',
      'card.tierLabel': 'Service tier',
      'card.tier.off': 'Off',
      'card.tier.flex': 'Flex (-50%)',
      'card.tier.standard': 'Standard',
      'card.tier.priority': 'Priority',
      'card.tierHint.off': 'Disabled. Requests use Gemini API default Standard behavior.',
      'card.tierHint.flex': 'Flex tier (~50% lower cost, variable latency, best-effort availability; may return 429/503 under peak load).',
      'card.tierHint.standard': 'Explicitly sends serviceTier: "standard" on matched requests.',
      'card.tierHint.priority': 'Explicitly sends serviceTier: "priority" for lower latency at higher cost.',
      'card.timeoutLabel': 'Server timeout (X-Server-Timeout)',
      'card.timeoutHint': 'Integer seconds between 0 and 3600 (0 disables the header). Recommended 600s for Flex.',
      'card.timeoutError': 'Timeout must be an integer between 0 and 3600 seconds.',
      'card.timeoutOff': 'Off',
      'card.providersLabel': 'Target provider routes',
      'card.providersPlaceholder': 'google (comma-separated, supports * wildcard)',
      'card.providersHint': 'Leave empty to match generativelanguage.googleapis.com and extra hosts automatically.',
      'card.modelsLabel': 'Model filters (optional)',
      'card.modelsPlaceholder': 'Empty = all models, e.g. gemini-2.5-*, gemini-3-*',
      'card.hostsLabel': 'Extra relay hosts (optional)',
      'card.hostsPlaceholder': 'e.g. gemini-proxy.example.com, *.relay.dev',
      'card.debugLabel': 'Debug logging',
      'card.debugHint': 'Log injected serviceTier and x-gemini-service-tier response headers on the Host.',
      'card.save': 'Save filters',
      'card.saving': 'Saving…',
      'card.saved': 'Saved',
      'card.conflict': 'Settings changed elsewhere; reloaded the latest values. Please review and save again.',
      'card.readonly': 'Profile settings are read-only in this environment.',
      'card.loading': 'Loading Gemini Flex settings…',
      'card.commandTip': 'Tip: Run /gemini-flex status in chat to inspect the last x-gemini-service-tier header returned by Google.',
    }

    const DICT_ZH = {
      'menu.label': 'Gemini 档位',
      'menu.tier.off': '关闭',
      'menu.tier.flex': 'Flex',
      'menu.tier.standard': '标准',
      'menu.tier.priority': '优先',
      'menu.tip.matched': '全局生效 — 已命中当前模型（{provider}/{model}）。',
      'menu.tip.unmatched': '全局生效 — 作用于已配置的 Gemini 路线（{providers}）。',
      'menu.tip.auto': '全局生效 — 自动匹配 Gemini 官方域名与扩展中转域名。',
      'menu.tip.readonly': '当前环境的配置为只读，无法保存修改。',
      'menu.tip.loading': '正在加载 Gemini Flex 配置…',
      'menu.failed': '切换 Gemini 档位失败：{message}',
      'card.title': 'Gemini Flex 档位',
      'card.subtitle': '全局生效：为所有会话中匹配的 Gemini Developer API 路线自动注入请求体 serviceTier 参数与可选 X-Server-Timeout 超时头。',
      'card.badge.off': '已关闭',
      'card.badge.flex': 'Flex · 省 50%',
      'card.badge.standard': '标准',
      'card.badge.priority': '优先',
      'card.tierLabel': '服务档位（serviceTier）',
      'card.tier.off': '关闭',
      'card.tier.flex': 'Flex（省 50%）',
      'card.tier.standard': '标准',
      'card.tier.priority': '优先',
      'card.tierHint.off': '已关闭注入，请求保持 Gemini API 默认标准行为。',
      'card.tierHint.flex': 'Flex 档位：费用约为标准价的 50%，延迟存在波动；高峰期可能返回 429/503 且服务端不会自动升档计费。',
      'card.tierHint.standard': '显式发送 serviceTier: "standard"。',
      'card.tierHint.priority': '显式发送 serviceTier: "priority"（更低延迟，费用更高）。',
      'card.timeoutLabel': '服务端超时（X-Server-Timeout）',
      'card.timeoutHint': '0 至 3600 的整数秒（0 表示不发送该请求头）。Flex 档位建议 600 秒。',
      'card.timeoutError': '超时时长必须为 0 至 3600 之间的整数（秒）。',
      'card.timeoutOff': '关闭',
      'card.providersLabel': '目标 Provider 路线',
      'card.providersPlaceholder': 'google（逗号分隔，支持 * 通配符）',
      'card.providersHint': '留空时自动匹配 generativelanguage.googleapis.com 与下方扩展域名。',
      'card.modelsLabel': '模型过滤（可选）',
      'card.modelsPlaceholder': '留空匹配全部模型，例如 gemini-2.5-*, gemini-3-*',
      'card.hostsLabel': '自定义中转域名（可选）',
      'card.hostsPlaceholder': '例如 gemini-proxy.example.com, *.relay.dev',
      'card.debugLabel': '调试日志',
      'card.debugHint': '在 Host 日志输出每次注入与 Google 返回的 x-gemini-service-tier 响应头。',
      'card.save': '保存规则',
      'card.saving': '保存中…',
      'card.saved': '已保存',
      'card.conflict': '配置已在其他位置更新，已刷新最新值，请确认后重新保存。',
      'card.readonly': '当前环境的配置为只读，无法保存修改。',
      'card.loading': '正在加载 Gemini Flex 配置…',
      'card.commandTip': '提示：也可在对话中输入 /gemini-flex status 查看最近一次 Google 实际返回的 x-gemini-service-tier 响应头。',
    }

    const CSS = `
.dsh-gf-menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-height: 34px;
  padding: 3px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
.dsh-gf-menu-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}
.dsh-gf-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
  background: var(--dsw-alias-state-idle-primary);
}
.dsh-gf-dot--flex {
  background: var(--dsw-alias-state-success-primary);
}
.dsh-gf-dot--standard {
  background: var(--dsw-alias-state-business-primary);
}
.dsh-gf-dot--priority {
  background: var(--dsw-alias-state-warn-primary);
}
.dsh-gf-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-module-platform);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-gf-seg--wrap {
  flex-wrap: wrap;
}
.dsh-gf-seg-btn {
  appearance: none;
  border: 0.5px solid transparent;
  margin: 0;
  padding: 2px 7px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11.5px;
  line-height: 18px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
.dsh-gf-seg-btn:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-gf-seg-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-gf-seg-btn--active {
  background: var(--dsw-alias-bg-layer-1);
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-gf-seg-btn--active:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-gf-seg-btn--active-flex {
  background: var(--dsw-alias-state-business-primary);
  border-color: transparent;
  color: var(--dsw-alias-label-on-color);
  font-weight: 500;
}
.dsh-gf-seg-btn--active-flex:hover:not(:disabled) {
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-on-color);
}
.dsh-gf-seg-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dsh-gf-card {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: var(--dsw-radius-xl, 12px);
  background: var(--dsw-alias-settings-card-fill);
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  color: var(--dsw-alias-label-primary);
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
}
.dsh-gf-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-gf-card-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 200px;
}
.dsh-gf-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh-gf-card-sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-gf-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  background: var(--dsw-alias-bg-module-platform);
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-gf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dsh-gf-field--grow {
  flex: 1 1 0;
  min-width: 0;
}
.dsh-gf-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-gf-field-row--switch {
  flex-wrap: nowrap;
  align-items: center;
}
.dsh-gf-field-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-gf-field-hint {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-gf-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-gf-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.dsh-gf-input--num {
  width: 96px;
  flex: none;
}
.dsh-gf-input--invalid {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-gf-input:focus-visible {
  outline: none;
  border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-gf-preset {
  appearance: none;
  padding: 5px 9px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
.dsh-gf-preset:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l4);
}
.dsh-gf-preset:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-gf-preset--active {
  background: var(--dsw-alias-bg-layer-1);
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-gf-preset:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-gf-switch {
  position: relative;
  width: 34px;
  height: 20px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease, border-color 140ms ease;
}
.dsh-gf-switch[aria-checked="true"] {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.dsh-gf-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--dsw-alias-switch-thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
  transition: transform 140ms ease, background-color 140ms ease;
}
.dsh-gf-switch[aria-checked="true"]::after {
  transform: translateX(14px);
  background: var(--dsw-alias-label-on-color);
}
.dsh-gf-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dsh-gf-switch:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-gf-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-gf-btn {
  appearance: none;
  padding: 6px 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 18px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.dsh-gf-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-gf-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-gf-btn--primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-gf-btn--primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-fill);
  opacity: 0.9;
}
.dsh-gf-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-gf-status-msg {
  font-size: 12px;
  line-height: 17px;
  min-height: 17px;
  color: var(--dsw-alias-state-success-primary);
}
.dsh-gf-status-msg--error {
  color: var(--dsw-alias-state-error-primary);
}
@media (prefers-reduced-motion: reduce) {
  .dsh-gf-seg-btn,
  .dsh-gf-input,
  .dsh-gf-preset,
  .dsh-gf-switch,
  .dsh-gf-switch::after,
  .dsh-gf-btn {
    transition: none;
  }
}
`

    function normalizeConfig(raw) {
      const value = raw && typeof raw === 'object' ? raw : {}
      const tier = TIERS.includes(value.serviceTier) ? value.serviceTier : 'flex'
      const timeout = Number.isInteger(value.serverTimeoutSec) ? value.serverTimeoutSec : 600
      const providers = Array.isArray(value.providers) ? value.providers.filter(s => typeof s === 'string') : ['google']
      const modelPatterns = Array.isArray(value.modelPatterns) ? value.modelPatterns.filter(s => typeof s === 'string') : []
      const extraHosts = Array.isArray(value.extraHosts) ? value.extraHosts.filter(s => typeof s === 'string') : []
      const debugLog = Boolean(value.debugLog)
      return {
        serviceTier: tier,
        serverTimeoutSec: timeout,
        providers,
        modelPatterns,
        extraHosts,
        debugLog,
      }
    }

    function parseCsv(text) {
      const seen = new Set()
      const out = []
      for (const raw of String(text ?? '').split(/[\n,]/)) {
        const trimmed = raw.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(trimmed)
      }
      return out
    }

    function matchesWildcard(value, pattern) {
      const needle = String(pattern ?? '').trim().toLowerCase()
      if (!needle) return false
      const hay = String(value ?? '').trim().toLowerCase()
      if (needle === '*') return true
      if (!needle.includes('*')) return hay === needle
      const escaped = needle.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      return new RegExp(`^${escaped}$`, 'i').test(hay)
    }

    function matchesCurrentSelection(selection, config) {
      const provider = selection?.provider ?? ''
      const model = selection?.model ?? ''
      if (!provider) return false

      const providerMatched = config.providers.length > 0
        ? config.providers.some(pat => matchesWildcard(provider, pat))
        : (provider.toLowerCase().includes('google') || provider.toLowerCase().includes('gemini'))

      if (!providerMatched) return false

      if (config.modelPatterns.length > 0) {
        return config.modelPatterns.some((pat) => {
          if (pat.includes('*')) return matchesWildcard(model, pat)
          return model.toLowerCase().includes(pat.toLowerCase())
        })
      }
      return true
    }

    function formatTemplate(template, vars) {
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (_match, key) => (vars[key] === undefined ? '' : String(vars[key])))
    }

    function readActiveLocale(ctx) {
      const localeSvc = ctx.get('locale')
      const snap = localeSvc?.getLocale?.() ?? localeSvc?.getSnapshot?.()
      if (snap && typeof snap.active === 'string' && snap.active) {
        return `${snap.active}:${snap.revision ?? 0}`
      }
      if (typeof navigator !== 'undefined' && navigator.language) {
        return `${navigator.language}:0`
      }
      return 'en:0'
    }

    function createLocalTranslator(ctx) {
      return (key, vars) => {
        const localeSvc = ctx.get('locale')
        const snap = localeSvc?.getLocale?.() ?? localeSvc?.getSnapshot?.()
        const rawLocale = snap?.active ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
        const isZh = String(rawLocale).toLowerCase().startsWith('zh')
        const dict = isZh ? DICT_ZH : DICT_EN
        const text = dict[key] ?? DICT_EN[key] ?? key
        return formatTemplate(text, vars)
      }
    }

    function isConflictError(err) {
      return err?.code === 'settings/conflict' || /conflict|revision/i.test(err?.message ?? '')
    }

    function createFlexSettingsStore(scope) {
      let state = {
        status: 'idle',
        ns: NS,
        writable: true,
        revision: undefined,
        config: normalizeConfig({}),
        error: null,
      }
      const listeners = new Set()
      let inFlight = null

      const emit = (next) => {
        state = next
        for (const fn of listeners) fn()
      }

      const applyNamespaceView = (view, writable) => {
        if (!view) return
        emit({
          status: 'ready',
          ns: view.ns,
          writable: writable === undefined ? state.writable : writable,
          revision: view.revision,
          config: normalizeConfig(view.value),
          error: null,
        })
      }

      const load = () => {
        if (inFlight) return inFlight
        if (state.status === 'idle') {
          emit({ ...state, status: 'loading' })
        }
        inFlight = Promise.resolve().then(async () => {
          try {
            const response = await scope.remote.settings.describe()
            if (!response.ok) {
              emit({ ...state, status: 'ready', error: response.error.message })
              return
            }
            const namespaces = response.value.namespaces ?? []
            const found = namespaces.find(row => row.ns === NS || row.ns.endsWith(`:${NS}`))
            if (found) {
              applyNamespaceView(found, response.value.writable)
            } else {
              emit({
                ...state,
                status: 'ready',
                writable: response.value.writable,
                error: null,
              })
            }
          } catch (error) {
            emit({
              ...state,
              status: 'ready',
              error: error instanceof Error ? error.message : String(error),
            })
          } finally {
            inFlight = null
          }
        })
        return inFlight
      }

      /**
       * Persist a settings patch.
       * - Single-field quick toggles pass `retryOnConflict: true` (reload fresh revision and retry once).
       * - Multi-field form saves keep `retryOnConflict: false` so concurrent edits are surfaced instead of overwritten.
       */
      const update = async (patch, options = {}) => {
        if (state.status === 'idle') await load()
        try {
          const response = await scope.remote.settings.update(state.ns, patch, state.revision)
          if (response.ok) {
            applyNamespaceView(response.value)
            return { ok: true, config: normalizeConfig(response.value.value) }
          }
          if (isConflictError(response.error)) {
            await load()
            if (options.retryOnConflict) {
              const retry = await scope.remote.settings.update(state.ns, patch, state.revision)
              if (retry.ok) {
                applyNamespaceView(retry.value)
                return { ok: true, config: normalizeConfig(retry.value.value) }
              }
              return { ok: false, conflict: isConflictError(retry.error), error: retry.error.message }
            }
            return { ok: false, conflict: true, error: response.error.message }
          }
          return { ok: false, conflict: false, error: response.error.message }
        } catch (error) {
          return { ok: false, conflict: false, error: error instanceof Error ? error.message : String(error) }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        ensure: () => (state.status === 'idle' ? load() : Promise.resolve()),
        load,
        update,
      }
    }

    function useLocaleKey(ctx) {
      const localeSvc = ctx.get('locale')
      return useSyncExternalStore(
        (fn) => (localeSvc && typeof localeSvc.subscribe === 'function' ? localeSvc.subscribe(fn) : () => {}),
        () => readActiveLocale(ctx),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 1. Insert scoped CSS and remove on unload.
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          let el = document.getElementById(STYLE_ID)
          if (!el) {
            el = document.createElement('style')
            el.id = STYLE_ID
            document.head.appendChild(el)
          }
          el.textContent = CSS
          return () => {
            const current = document.getElementById(STYLE_ID)
            if (current) current.remove()
          }
        }, 'gemini-flex: styles')

        // 2. Register localized dictionaries when locale service is present.
        ctx.inject(['locale'], (localeScope) => {
          localeScope.effect(
            () => localeScope.locale.register(NS, { en: DICT_EN, zh: DICT_ZH }),
            'gemini-flex: locale',
          )
        })

        // 3. Mount interactive controls once `remote.settings` is available.
        ctx.inject(['remote', 'remote.settings'], (scope) => {
          const store = createFlexSettingsStore(scope)
          const translate = createLocalTranslator(ctx)

          scope.effect(() => {
            const disposers = []
            if (typeof scope.remote.$on === 'function') {
              disposers.push(scope.remote.$on('settings/document-updated', (ns) => {
                if (!ns || ns === NS || String(ns).endsWith(`:${NS}`)) {
                  void store.load()
                }
              }))
            }
            disposers.push(scope.on('connection/reset', () => { void store.load() }))
            void store.ensure()
            return () => {
              for (const dispose of disposers) dispose()
            }
          }, 'gemini-flex: settings sync')

          function ModelMenuFlexOption(props) {
            useLocaleKey(ctx)
            const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
            const modelSelection = typeof props.useProjection === 'function'
              ? props.useProjection('modelSelection')
              : undefined
            const [pending, setPending] = useState(false)

            useEffect(() => {
              void store.ensure()
            }, [])

            const isReady = snap.status === 'ready'
            const currentTier = snap.config.serviceTier
            const activeSelection = modelSelection?.next ?? modelSelection?.lastUsed ?? null
            const matched = matchesCurrentSelection(activeSelection, snap.config)

            let tooltipText
            if (!isReady) {
              tooltipText = translate('menu.tip.loading')
            } else if (!snap.writable) {
              tooltipText = translate('menu.tip.readonly')
            } else if (snap.error) {
              tooltipText = translate('menu.failed', { message: snap.error })
            } else if (matched && activeSelection?.model) {
              tooltipText = translate('menu.tip.matched', {
                provider: activeSelection.provider,
                model: activeSelection.model,
              })
            } else if (snap.config.providers.length === 0) {
              tooltipText = translate('menu.tip.auto')
            } else {
              tooltipText = translate('menu.tip.unmatched', {
                providers: snap.config.providers.join(', '),
              })
            }

            const selectTier = (tier) => {
              if (!isReady || pending || props.locked || !snap.writable || tier === currentTier) return
              setPending(true)
              void store.update({ serviceTier: tier }, { retryOnConflict: true }).then((res) => {
                if (!res.ok && typeof props.reportFailure === 'function') {
                  props.reportFailure(translate('menu.failed', { message: res.error ?? 'unknown error' }))
                }
              }).finally(() => {
                setPending(false)
              })
            }

            return h('div', {
              className: 'dsh-gf-menu-row',
              title: tooltipText,
            },
              h('span', { className: 'dsh-gf-menu-label' },
                h('span', {
                  className: `dsh-gf-dot${isReady ? ` dsh-gf-dot--${currentTier}` : ''}`,
                  'aria-hidden': true,
                }),
                h('span', null, translate('menu.label')),
              ),
              h('div', {
                className: 'dsh-gf-seg',
                role: 'group',
                'aria-label': translate('menu.label'),
              }, ...TIERS.map((tier) => {
                const isActive = isReady && currentTier === tier
                const btnClass = [
                  'dsh-gf-seg-btn',
                  isActive ? (tier === 'flex' ? 'dsh-gf-seg-btn--active-flex' : 'dsh-gf-seg-btn--active') : '',
                ].filter(Boolean).join(' ')
                return h('button', {
                  key: tier,
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': isActive,
                  className: btnClass,
                  disabled: !isReady || Boolean(props.locked) || pending || !snap.writable,
                  onClick: (event) => {
                    event.stopPropagation()
                    selectTier(tier)
                  },
                }, translate(`menu.tier.${tier}`))
              })),
            )
          }

          function ModelsSettingsFlexCard() {
            useLocaleKey(ctx)
            const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
            const cfg = snap.config
            const baseId = useId()
            const timeoutInputId = `${baseId}-timeout`
            const providersInputId = `${baseId}-providers`
            const modelsInputId = `${baseId}-models`
            const hostsInputId = `${baseId}-hosts`
            const debugLabelId = `${baseId}-debug`

            const [timeoutText, setTimeoutText] = useState(String(cfg.serverTimeoutSec))
            const [providersText, setProvidersText] = useState(cfg.providers.join(', '))
            const [modelsText, setModelsText] = useState(cfg.modelPatterns.join(', '))
            const [hostsText, setHostsText] = useState(cfg.extraHosts.join(', '))
            const [saving, setSaving] = useState(false)
            const [notice, setNotice] = useState(null)
            const noticeTimerRef = useRef(null)

            const showNotice = (nextNotice, autoClearMs = 0) => {
              if (noticeTimerRef.current !== null) {
                clearTimeout(noticeTimerRef.current)
                noticeTimerRef.current = null
              }
              setNotice(nextNotice)
              if (nextNotice && autoClearMs > 0) {
                noticeTimerRef.current = setTimeout(() => {
                  setNotice(null)
                  noticeTimerRef.current = null
                }, autoClearMs)
              }
            }

            useEffect(() => {
              void store.ensure()
              return () => {
                if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current)
              }
            }, [])

            // Sync each field independently so quick-toggling timeout/tier never wipes unsaved edits in other inputs.
            useEffect(() => {
              setTimeoutText(String(cfg.serverTimeoutSec))
            }, [cfg.serverTimeoutSec])

            const providersJoined = cfg.providers.join(', ')
            useEffect(() => {
              setProvidersText(providersJoined)
            }, [providersJoined])

            const modelsJoined = cfg.modelPatterns.join(', ')
            useEffect(() => {
              setModelsText(modelsJoined)
            }, [modelsJoined])

            const hostsJoined = cfg.extraHosts.join(', ')
            useEffect(() => {
              setHostsText(hostsJoined)
            }, [hostsJoined])

            const applyQuickPatch = async (patch) => {
              if (!snap.writable || saving) return
              setSaving(true)
              showNotice(null)
              const res = await store.update(patch, { retryOnConflict: true })
              setSaving(false)
              if (res.ok) {
                showNotice({ kind: 'ok', text: translate('card.saved') }, 2500)
              } else {
                showNotice({ kind: 'error', text: res.error ?? 'Failed to save' })
              }
            }

            const trimmedTimeout = timeoutText.trim()
            const timeoutValid = /^\d+$/.test(trimmedTimeout)
              && Number(trimmedTimeout) >= 0
              && Number(trimmedTimeout) <= 3600

            const dirtyFilters =
              String(cfg.serverTimeoutSec) !== trimmedTimeout
              || providersJoined !== providersText.trim()
              || modelsJoined !== modelsText.trim()
              || hostsJoined !== hostsText.trim()

            const saveFilters = async () => {
              if (!snap.writable || saving) return
              if (!timeoutValid) {
                showNotice({ kind: 'error', text: translate('card.timeoutError') })
                return
              }
              const parsedTimeout = Number.parseInt(trimmedTimeout, 10)
              const nextProviders = parseCsv(providersText)
              const nextModels = parseCsv(modelsText)
              const nextHosts = parseCsv(hostsText)

              setSaving(true)
              showNotice(null)
              const res = await store.update({
                serverTimeoutSec: parsedTimeout,
                providers: nextProviders,
                modelPatterns: nextModels,
                extraHosts: nextHosts,
              }, { retryOnConflict: false })
              setSaving(false)

              if (res.ok) {
                // Re-normalize input fields immediately even when normalized arrays equal previous values.
                const saved = res.config ?? cfg
                setTimeoutText(String(saved.serverTimeoutSec))
                setProvidersText(saved.providers.join(', '))
                setModelsText(saved.modelPatterns.join(', '))
                setHostsText(saved.extraHosts.join(', '))
                showNotice({ kind: 'ok', text: translate('card.saved') }, 2500)
              } else if (res.conflict) {
                showNotice({ kind: 'error', text: translate('card.conflict') })
              } else {
                showNotice({ kind: 'error', text: res.error ?? 'Failed to save' })
              }
            }

            if (snap.status === 'idle' || snap.status === 'loading') {
              return h('section', { className: 'dsh-gf-card' },
                h('p', { className: 'dsh-gf-card-sub' }, translate('card.loading')),
              )
            }

            const statusError = notice?.kind === 'error' || Boolean(snap.error)
            const statusText = !snap.writable
              ? translate('card.readonly')
              : (notice?.text ?? snap.error ?? '')

            return h('section', { className: 'dsh-gf-card', 'aria-label': translate('card.title') },
              // Header
              h('div', { className: 'dsh-gf-card-head' },
                h('div', { className: 'dsh-gf-card-title-wrap' },
                  h('h3', { className: 'dsh-gf-card-title' }, translate('card.title')),
                  h('p', { className: 'dsh-gf-card-sub' }, translate('card.subtitle')),
                ),
                h('span', { className: 'dsh-gf-badge' },
                  h('span', { className: `dsh-gf-dot dsh-gf-dot--${cfg.serviceTier}`, 'aria-hidden': true }),
                  h('span', null, translate(`card.badge.${cfg.serviceTier}`)),
                ),
              ),

              // Service tier segmented buttons
              h('div', { className: 'dsh-gf-field' },
                h('div', { className: 'dsh-gf-field-row' },
                  h('span', { className: 'dsh-gf-field-label' }, translate('card.tierLabel')),
                  h('div', {
                    className: 'dsh-gf-seg dsh-gf-seg--wrap',
                    role: 'radiogroup',
                    'aria-label': translate('card.tierLabel'),
                  }, ...TIERS.map((tier) => {
                    const isActive = cfg.serviceTier === tier
                    const btnClass = [
                      'dsh-gf-seg-btn',
                      isActive ? (tier === 'flex' ? 'dsh-gf-seg-btn--active-flex' : 'dsh-gf-seg-btn--active') : '',
                    ].filter(Boolean).join(' ')
                    return h('button', {
                      key: tier,
                      type: 'button',
                      role: 'radio',
                      'aria-checked': isActive,
                      className: btnClass,
                      disabled: !snap.writable || saving,
                      onClick: () => {
                        if (tier !== cfg.serviceTier) void applyQuickPatch({ serviceTier: tier })
                      },
                    }, translate(`card.tier.${tier}`))
                  })),
                ),
                h('span', { className: 'dsh-gf-field-hint' }, translate(`card.tierHint.${cfg.serviceTier}`)),
              ),

              // X-Server-Timeout
              h('div', { className: 'dsh-gf-field' },
                h('label', { className: 'dsh-gf-field-label', htmlFor: timeoutInputId }, translate('card.timeoutLabel')),
                h('div', { className: 'dsh-gf-input-row' },
                  h('input', {
                    id: timeoutInputId,
                    type: 'number',
                    min: 0,
                    max: 3600,
                    step: 1,
                    'aria-invalid': !timeoutValid,
                    className: `dsh-gf-input dsh-gf-input--num${!timeoutValid ? ' dsh-gf-input--invalid' : ''}`,
                    value: timeoutText,
                    disabled: !snap.writable || saving,
                    onChange: (event) => {
                      setTimeoutText(event.target.value)
                      if (notice?.kind === 'ok') showNotice(null)
                    },
                  }),
                  ...TIMEOUT_PRESETS.map(sec => h('button', {
                    key: sec,
                    type: 'button',
                    className: `dsh-gf-preset${cfg.serverTimeoutSec === sec ? ' dsh-gf-preset--active' : ''}`,
                    disabled: !snap.writable || saving,
                    onClick: () => {
                      setTimeoutText(String(sec))
                      void applyQuickPatch({ serverTimeoutSec: sec })
                    },
                  }, sec === 0 ? translate('card.timeoutOff') : `${sec}s`)),
                ),
                h('span', {
                  className: timeoutValid ? 'dsh-gf-field-hint' : 'dsh-gf-status-msg dsh-gf-status-msg--error',
                }, timeoutValid ? translate('card.timeoutHint') : translate('card.timeoutError')),
              ),

              // Target providers
              h('div', { className: 'dsh-gf-field' },
                h('label', { className: 'dsh-gf-field-label', htmlFor: providersInputId }, translate('card.providersLabel')),
                h('input', {
                  id: providersInputId,
                  type: 'text',
                  className: 'dsh-gf-input',
                  value: providersText,
                  placeholder: translate('card.providersPlaceholder'),
                  disabled: !snap.writable || saving,
                  onChange: (event) => {
                    setProvidersText(event.target.value)
                    if (notice?.kind === 'ok') showNotice(null)
                  },
                }),
                h('span', { className: 'dsh-gf-field-hint' }, translate('card.providersHint')),
              ),

              // Optional model filters
              h('div', { className: 'dsh-gf-field' },
                h('label', { className: 'dsh-gf-field-label', htmlFor: modelsInputId }, translate('card.modelsLabel')),
                h('input', {
                  id: modelsInputId,
                  type: 'text',
                  className: 'dsh-gf-input',
                  value: modelsText,
                  placeholder: translate('card.modelsPlaceholder'),
                  disabled: !snap.writable || saving,
                  onChange: (event) => {
                    setModelsText(event.target.value)
                    if (notice?.kind === 'ok') showNotice(null)
                  },
                }),
              ),

              // Optional extra hosts
              h('div', { className: 'dsh-gf-field' },
                h('label', { className: 'dsh-gf-field-label', htmlFor: hostsInputId }, translate('card.hostsLabel')),
                h('input', {
                  id: hostsInputId,
                  type: 'text',
                  className: 'dsh-gf-input',
                  value: hostsText,
                  placeholder: translate('card.hostsPlaceholder'),
                  disabled: !snap.writable || saving,
                  onChange: (event) => {
                    setHostsText(event.target.value)
                    if (notice?.kind === 'ok') showNotice(null)
                  },
                }),
              ),

              // Debug log switch
              h('div', { className: 'dsh-gf-field-row dsh-gf-field-row--switch' },
                h('div', { className: 'dsh-gf-field dsh-gf-field--grow' },
                  h('span', { id: debugLabelId, className: 'dsh-gf-field-label' }, translate('card.debugLabel')),
                  h('span', { className: 'dsh-gf-field-hint' }, translate('card.debugHint')),
                ),
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': cfg.debugLog,
                  'aria-labelledby': debugLabelId,
                  className: 'dsh-gf-switch',
                  disabled: !snap.writable || saving,
                  onClick: () => { void applyQuickPatch({ debugLog: !cfg.debugLog }) },
                }),
              ),

              // Actions & feedback
              h('div', { className: 'dsh-gf-actions' },
                h('span', {
                  role: statusError ? 'alert' : 'status',
                  'aria-live': statusError ? 'assertive' : 'polite',
                  className: `dsh-gf-status-msg${statusError ? ' dsh-gf-status-msg--error' : ''}`,
                }, statusText),
                h('button', {
                  type: 'button',
                  className: `dsh-gf-btn${dirtyFilters && timeoutValid ? ' dsh-gf-btn--primary' : ''}`,
                  disabled: !snap.writable || saving || !dirtyFilters || !timeoutValid,
                  onClick: () => { void saveFilters() },
                }, saving ? translate('card.saving') : translate('card.save')),
              ),

              h('span', { className: 'dsh-gf-field-hint' }, translate('card.commandTip')),
            )
          }

          scope.slots.inject('conversation.input.model.options', () => scope.slots.register({
            name: 'conversation.input.model.options',
            id: 'gemini-flex',
            order: 20,
            locale: NS,
          }, ModelMenuFlexOption))

          scope.slots.inject('settings.models.footer', () => scope.slots.register({
            name: 'settings.models.footer',
            id: 'gemini-flex',
            order: 10,
            locale: NS,
          }, ModelsSettingsFlexCard))
        })
      },
    }
  },
})
