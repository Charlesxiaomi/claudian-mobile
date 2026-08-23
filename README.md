# Claudian Mobile

A minimal AI writing and knowledge agent for your Obsidian vault. It calls the Anthropic Messages API directly from the client, so it works on Obsidian mobile (Android/iOS) as well as on desktop — no Node.js, no local CLI, no companion server.

## Features

- Chat panel in the right sidebar, with streaming replies.
- The agent can act on your vault through a small set of tools:
  - `read_note` — read a note's content
  - `write_note` — replace a note's full content
  - `patch_note` — apply a targeted edit to part of a note
  - `create_note` — create a new note
  - `search_vault` — full-text search across the vault
  - `list_files` — list files and folders
- Tool calls are rendered inline, and edits are shown as a diff before they land.
- All paths are normalized and confined to the vault; the plugin cannot read or write outside it.
- Works with any endpoint that implements the Anthropic `/v1/messages` streaming API, so you can point it at a proxy or a compatible third-party gateway.

## Requirements and network use

This plugin requires an account with a third-party AI provider:

- By default it sends your prompts, and the content of the notes the agent reads or edits, to the **Anthropic API** (`https://api.anthropic.com`) using an API key you supply. See Anthropic's [privacy policy](https://www.anthropic.com/legal/privacy) and [terms](https://www.anthropic.com/legal/consumer-terms).
- If you change **Base URL** in the settings, requests go to that endpoint instead. Whatever you point it at receives the same data.
- No other network requests are made. There is no telemetry.
- Usage of the API is billed to your own account by your provider.

Your API key is stored in plaintext in `.obsidian/plugins/claudian-mobile/data.json` inside your vault. If your vault is synced or shared, the key travels with it — use a key you are comfortable having on every device that syncs the vault.

## Setup

1. Install the plugin (see below) and enable it.
2. Open **Settings → Claudian Mobile** and paste your Anthropic API key (`sk-ant-...`). You can create one at [console.anthropic.com](https://console.anthropic.com/).
3. Optionally adjust the model, base URL, output token limit, tool-iteration cap, and system prompt.
4. Open the chat with the ribbon icon (bot) or the **Claudian Mobile: Open chat** command.

## Installation

### From the community plugin list

Not yet available — this plugin is pending review.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Charlesxiaomi/claudian-mobile/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/claudian-mobile/`.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

### Via BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add the beta plugin `Charlesxiaomi/claudian-mobile`.

## Development

```bash
npm install
npm run dev        # watch build
npm run build      # production build
npm test           # jest unit tests
npm run typecheck
npm run lint
```

Set `OBSIDIAN_VAULT=/path/to/vault` to have the build copy `main.js`, `manifest.json`, and `styles.css` straight into that vault's plugin folder.

## License

[MIT](LICENSE)
