import assert from 'node:assert/strict'
import {
  INTERNAL_META_HEADER,
  INTERNAL_TIER_HEADER,
  Config,
  createFetchWrapper,
  injectServiceTierIntoBody,
  isGenerateContentUrl,
  shouldApplyToRequest,
} from './index.js'

async function runTests() {
  // 1. Config schema defaults & volatile metadata
  assert.equal(Config.type, 'object')
  assert.equal(Config.dict.serviceTier.meta.default, 'flex')
  assert.equal(Config.dict.serviceTier.meta.volatile, true)
  assert.equal(Config.dict.serverTimeoutSec.meta.default, 600)
  assert.equal(Config.dict.serverTimeoutSec.meta.volatile, true)
  const resolved = Config({})
  assert.equal(resolved.serviceTier.get(), 'flex')
  assert.equal(resolved.serverTimeoutSec.get(), 600)
  assert.deepEqual(resolved.providers.get(), ['google'])

  // 2. Request matching rules
  const defaultCfg = {
    serviceTier: 'flex',
    serverTimeoutSec: 600,
    providers: ['google'],
    modelPatterns: [],
    extraHosts: [],
    debugLog: false,
  }
  assert.equal(shouldApplyToRequest({
    provider: 'google',
    model: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  }, defaultCfg), true)

  assert.equal(shouldApplyToRequest({
    provider: 'openai',
    model: 'gpt-5',
    baseURL: 'https://api.openai.com/v1',
  }, defaultCfg), false)

  assert.equal(shouldApplyToRequest({
    provider: 'google',
    model: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  }, { ...defaultCfg, serviceTier: 'off' }), false)

  assert.equal(shouldApplyToRequest({
    provider: 'my-gemini-relay',
    model: 'gemini-3-flash',
    baseURL: 'https://relay.example.com/v1beta',
  }, { ...defaultCfg, providers: ['google', 'my-gemini-*'] }), true)

  assert.equal(shouldApplyToRequest({
    provider: 'google',
    model: 'gemini-2.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  }, { ...defaultCfg, modelPatterns: ['gemini-2.5-pro'] }), false)

  assert.equal(shouldApplyToRequest({
    provider: 'google',
    model: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  }, { ...defaultCfg, modelPatterns: ['gemini-2.5-*'] }), true)

  // 3. Endpoint matching
  assert.equal(isGenerateContentUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'), true)
  assert.equal(isGenerateContentUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'), true)
  assert.equal(isGenerateContentUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:countTokens'), false)
  assert.equal(isGenerateContentUrl('https://generativelanguage.googleapis.com/v1beta/models'), false)

  // 4. Body injection
  const bodyRes = injectServiceTierIntoBody(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }), 'flex')
  assert.equal(bodyRes.changed, true)
  assert.equal(JSON.parse(bodyRes.body).serviceTier, 'flex')

  // 5. Fetch wrapper: injects on matched generateContent, strips internal headers, records x-gemini-service-tier
  const calls = []
  const observed = []
  const fakeFetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    calls.push({
      url: typeof input === 'string' ? input : input.url,
      headers: Object.fromEntries(headers.entries()),
      body: init?.body,
    })
    return new Response('{}', {
      status: 200,
      headers: { 'x-gemini-service-tier': 'flex' },
    })
  }

  const { wrappedFetch, dispose } = createFetchWrapper(fakeFetch, {
    onResponse: record => observed.push(record),
  })

  // 5a. Matched streamGenerateContent call
  await wrappedFetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '20',
        'x-server-timeout': '600',
        [INTERNAL_TIER_HEADER]: 'flex',
        [INTERNAL_META_HEADER]: 'google/gemini-2.5-pro',
      },
      body: JSON.stringify({ contents: [] }),
    },
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers[INTERNAL_TIER_HEADER], undefined)
  assert.equal(calls[0].headers[INTERNAL_META_HEADER], undefined)
  assert.equal(calls[0].headers['content-length'], undefined)
  assert.equal(calls[0].headers['x-server-timeout'], '600')
  assert.deepEqual(JSON.parse(calls[0].body), { contents: [], serviceTier: 'flex' })
  assert.equal(observed.length, 1)
  assert.equal(observed[0].appliedTier, 'flex')
  assert.equal(observed[0].requestedTier, 'flex')
  assert.equal(observed[0].route, 'google/gemini-2.5-pro')

  // 5b. Non-generateContent URL still strips internal markers without mutating body
  await wrappedFetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:countTokens',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_TIER_HEADER]: 'flex',
        [INTERNAL_META_HEADER]: 'google/gemini-2.5-pro',
      },
      body: JSON.stringify({ contents: [] }),
    },
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers[INTERNAL_TIER_HEADER], undefined)
  assert.deepEqual(JSON.parse(calls[1].body), { contents: [] })
  assert.equal(observed.length, 1)

  // 5c. Unmarked call passes through untouched
  await wrappedFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5' }),
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(JSON.parse(calls[2].body), { model: 'gpt-5' })

  // 5d. Dispose turns wrapper into transparent passthrough
  dispose()
  await wrappedFetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    },
  )
  assert.equal(calls.length, 4)
  assert.deepEqual(JSON.parse(calls[3].body), { contents: [] })

  console.log('All gemini-flex unit tests passed!')
}

await runTests()
