# 🐕 Watchdog — Sub Server

Report this machine's CPU, RAM, temperature, disk, network and top processes to a Watchdog main server
(its own project, **watchdog-main**, in a separate GitHub repo). Written in Node.js.

The sub server only talks to the main server over HTTPS: it sends a report every few seconds with its
per-server token, and pulls its own updates from **this** repo — never from the main server's repo.

```
  This machine                              Main server (watchdog-main project)
 ┌────────────────────┐   HTTPS, every 5 s   ┌───────────────────────────────┐
 │  SUB SERVER        │  ─────────────────▶  │  Telegram bot + dashboard   │
 │  (this project)    │  Bearer wd_… token   │  down / up / alert messages │
 │  CPU · RAM · temp  │                      │  /update → "update now"     │
 │  disk · net · procs│  ◀─────────────────  │  (this agent pulls the new   │
 └────────────────────┘   update requested   │   version from this repo)   │
                                          └───────────────────────────────┘
```

## 0. Put this project on GitHub

This project lives in its own GitHub repository: `github.com/bababoeiii/WATCHDOG_SUB`.
A **public** repo is simplest: the main server's bot can then give a one-line installer for each
sub server. A **private** repo works too: create a fine-grained token with read-only *Contents*
access and pass it as `UPDATE_GITHUB_TOKEN` (in `.env`) and `--github-token` (installer).

From then on, **every push to `main` is a release** for the sub servers. They pick it up within
30 minutes, or right away with `/update <name>` / `/update all` on the main server's bot.

## 1. Deploy

On the machine to monitor (Linux with systemd, Node.js 18+), **paste the one-liner** the main server's
bot gave you for `/add <name>` (it already contains the token and the main server URL):

```bash
curl -fsSL https://raw.githubusercontent.com/bababoeiii/WATCHDOG_SUB/main/install.sh | sudo bash -s -- \
  --repo https://github.com/bababoeiii/WATCHDOG_SUB.git --branch main \
  --main https://watchdog.example.com --token wd_Xb3k…
```

Or, from a clone:

```bash
cp .env.example .env            # paste MAIN_SERVER_URL + AGENT_TOKEN
npm ci && npm run check         # optional: prints what it measures
sudo bash install.sh            # → /opt/watchdog-sub, systemd service, auto-update on
```

Installer options: `--github-token TOKEN` (private repo), `--branch NAME`, `--no-auto-update`,
`--dir PATH`. Running it again updates the install and keeps `.env`.

- Logs: `journalctl -u watchdog-sub-server -f`
- New token? Edit `AGENT_TOKEN` in `/opt/watchdog-sub/.env`. The running agent picks it up within 10 seconds,
  no restart needed.
- Without systemd (macOS, Windows): run it from a git clone with `pm2 start src/agent.js --name watchdog`.
- Temperature is reported where the hardware exposes sensors (bare-metal Linux, most desktops). VMs usually have none.

## Settings

`.env`:

| Variable | Default | |
|---|---|
| `MAIN_SERVER_URL` | — | the main server's public URL, e.g. `https://watchdog.example.com` |
| `AGENT_TOKEN` | — | the token from the main server (`/add <name>`); shown only once there |
| `INTERVAL_SECONDS` | 5 | seconds between reports |
| `AUTO_UPDATE` | true | pull new versions from this repo's GitHub |
| `UPDATE_CHECK_MINUTES` | 30 | how often to check for a new version |
| `UPDATE_BRANCH` | checked-out branch | branch to follow |
| `UPDATE_GITHUB_TOKEN` | — | only for a private repository |

## Updates

An update goes like this: fetch → `git reset --hard origin/main` → `npm ci` if dependencies changed → `node
--check` on every source file → restart (about 2 seconds, without sending "goodbye", so an update never
triggers a down alert). If any step fails, the agent goes back to the commit it was on, keeps running,
and the main server reports **❗ update failed** with the reason.

Safety rules:
- **Local edits are never overwritten.** If tracked files were changed by hand, auto-update pauses and
  tells you.
- A README-only push updates the files without restarting the agent.
- Set `AUTO_UPDATE=false` to update only when the main server asks (`/update`).

## Tests

```bash
npm test     # real metrics sample, caching, settings validation
```

## Security

- The sub server runs as root so it can read every process and sensor. It only reads system stats.
- It authenticates to the main server with its own token (`Authorization: Bearer wd_…`). Use `https://`
  for `MAIN_SERVER_URL`: over plain `http://` the token travels unencrypted.
- Auto-update runs whatever is pushed to the branch, so protect the branch on GitHub (who can push).

## Layout

```
src/        agent.js (reports to the main server) · collect.js (metrics) · updater.js (git auto-update)
install.sh  systemd install · watchdog-sub-server.service · .env.example
```
