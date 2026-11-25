# Gemini Flex Tier (`@local/dsh-gemini-flex`)

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

1. Clone this repository to a local directory:
   ```bash
   git clone https://github.com/Remalloc/dsh-gemini-flex.git
   ```
2. In DeepSeek Harness, open **Settings > Plugins > Add plugin** and select the cloned local directory (or ask the Harness agent to install the local bundle path).

## Notes on Gemini Flex Tier

- Flex tier offers ~50% lower pricing than Standard in exchange for variable latency and best-effort availability.
- Under peak load, Gemini API may return HTTP `429` or `503` instead of upgrading to Standard billing.
- Disabling this plugin or setting `serviceTier` to `off` immediately restores default Standard requests.
