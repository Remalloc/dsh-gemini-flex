# Gemini Flex Tier (`dsh-gemini-flex`)

DeepSeek Harness plugin that enables **Gemini API Flex inference** (`serviceTier: "flex"`, plus `standard`, `priority`, and `off`) on your existing Google / Gemini routes without duplicating provider or API key setups.

## Features

- **Seamless reuse of existing Google routes**: Works with DeepSeek Harness's built-in `google` provider (and any custom Gemini Developer API relay provider you add to `providers`).
- **Exact request scoping**: Uses `llm-pi-ai/request-headers` + a scoped `fetch` wrapper so only `:generateContent` and `:streamGenerateContent` POST requests for matched routes receive top-level `serviceTier` in the JSON body; internal marker headers are stripped before sending.
- **Server timeout support**: Optionally attaches `X-Server-Timeout` (default `600` seconds) to accommodate Flex tier's variable latency.
- **Live UI controls**:
  - **Composer Model menu** (`Gemini tier`): Quick switch between `Off`, `Flex`, `Standard`, and `Priority`.
  - **Settings > Models** (`Gemini Flex tier` card): Full configuration for tier, `X-Server-Timeout`, target providers, optional model wildcards, and debug logging.
- **Slash command & Agent tool**:
  - `/gemini-flex [flex|standard|priority|off|timeout <sec>|status]`
  - Tool `gemini_service_tier` to inspect status (including the last observed `x-gemini-service-tier` response header) and update settings.

## Installation

### From npm (recommended)

In DeepSeek Harness Web UI, open **Plugins > Add plugin** and enter:

```text
dsh-gemini-flex
```

Or via CLI:

```bash
dsh plugin --profile web add dsh-gemini-flex
```

### From GitHub

In **Plugins > Add plugin**, enter `github:Remalloc/dsh-gemini-flex`, or via CLI:

```bash
dsh plugin --profile web add github:Remalloc/dsh-gemini-flex
```

### From a local clone

```bash
git clone https://github.com/Remalloc/dsh-gemini-flex.git
dsh plugin --profile web add ./dsh-gemini-flex
```

## Notes on Gemini Flex Tier

- Flex tier offers ~50% lower pricing than Standard in exchange for variable latency and best-effort availability.
- Under peak load, Gemini API may return HTTP `429` or `503` instead of upgrading to Standard billing.
- Disabling this plugin or setting `serviceTier` to `off` immediately restores default Standard requests.
