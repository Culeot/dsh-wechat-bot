# dsh-wechat-bot

A WeChat bridge management panel inside DeepSeek Harness Settings.

From Settings → 微信桥: scan-QR login for the WeChat bot, pick an agent mode (Standard / PTC / Minimal / Cordis / your custom preset), choose model & reasoning effort, manage credentials. Works with the standalone [weixin-bot](https://github.com/Culeot/dsh-wechat-bot) process (official Tencent iLink channel) — the bot talks through the DSH web session API, so you get **real session context** and the preset's plugins (memory / MCP / skills) all loaded.

## Features

- **Settings panel**: connection status, QR login, credentials, delete bot — same menu level as General.
- **Agent modes**: Standard / PTC / Minimal / Cordis (official presets) + custom agent (pick your own user preset, e.g. potato).
- **Model & reasoning effort**: read live from the DSH model catalog; empty = follow the main agent.
- **Access control**: only the scanning account (owner) can connect.
- **Real sessions**: WeChat messages go through the DSH web session API — continuous context, preset plugins active.

## Architecture

```
WeChat → weixin-bot (bridge.js, standalone, iLink official channel)
         → DSH web session API (session.create / prompt / history)
         → session built from the chosen preset → real context → reply back
```

- Plugin (`dsh-wechat-bot`): Settings panel + RPC (`/dsh-weixin-login`: state / QR / config / model catalog).
- Standalone (`weixin-bot`): WeChat send/receive + session orchestration, reads the same config (`~/.dsh/weixin-bridge-config.json`) and account (`~/.dsh/weixin-bot-account.json`).
- No public IP: official Tencent iLink Bot channel.

## Install

```bash
# 1. add dependency to your web profile
cd ~/.dsh/profiles/web
npm install dsh-wechat-bot
```

```yaml
# 2. add one row to your agent preset (~/.dsh/.agent-presets/<preset>/agent.cordis.yml)
- id: weixin-ui
  name: 'dsh-wechat-bot'
```

```bash
# 3. restart DSH; the 微信桥 panel appears in Settings
# 4. run the standalone bridge for message relay: node weixin-bot/bridge.js
```

## Standalone process (weixin-bot)

The panel only handles login & config; **message relay is done by the standalone bridge.js**, reading the same account/config files.

- Source: GitHub [Culeot/dsh-weixin-bridge](https://github.com/Culeot/dsh-wechat-bot)
- Run: `node bridge.js` (Node ≥ 20, DSH web running)
- Auto-start: Windows scheduled task / registry Run entry; add a watchdog to restart on crash
- Log: `bridge.log` (next to bridge.js)

## Configuration

| Item | Description |
|---|---|
| Agent mode | Standard / PTC / Minimal / Cordis / custom preset |
| Model / reasoning | read live from the DSH catalog; empty = follow the main agent |
| Working dir | agent working directory (empty = DSH default) |
| Access control | owner only (fixed) |

Config is stored at `~/.dsh/weixin-bridge-config.json`, auto-saved, read live by the bridge.

## Requirements

- DSH web running (the bot reuses its sessions)
- Node.js ≥ 20 (for the standalone bridge)

## License

MIT. Unofficial project, not affiliated with DeepSeek.
