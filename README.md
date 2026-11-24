# Radarr MCP Server

[![npm](https://img.shields.io/npm/v/@orellbuehler/radarr-mcp.svg)](https://www.npmjs.com/package/@orellbuehler/radarr-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@orellbuehler/radarr-mcp.svg)](https://www.npmjs.com/package/@orellbuehler/radarr-mcp)
[![CI](https://github.com/OrellBuehler/radarr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OrellBuehler/radarr-mcp/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@orellbuehler/radarr-mcp.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents full
access to your [Radarr](https://radarr.video/) movie library — adding and curating movies, driving
searches, and diagnosing why a download never turned into a file.

Point Claude (or any MCP client) at it and the agent can:

- **Curate the library** — look movies up on TMDB, add them with the right root folder and quality
  profile, bulk-edit monitoring, profiles and tags, and remove what you no longer want.
- **Drive searches** — run automatic searches, list what the indexers actually returned with their
  rejection reasons and custom format scores, and grab a specific release.
- **Work the queue** — see what is downloading, remove or blocklist a stuck grab, force pending
  items through, and inspect manual import candidates.
- **Explain itself** — history per movie, blocklist, health checks, logs, scheduled tasks, indexer
  and download client tests, remote path mappings, and release title parsing.

61 tools, zero install (`npx`), works with Claude Code, Claude Desktop, Cursor, and any other MCP
client.

## Example prompts

> "Add Dune Part Two in 4K to my library and search for it."

> "Nothing from my library has downloaded since Tuesday. Figure out what broke."

> "Which monitored movies are still missing a file, and are there any releases for them right now?"

> "This grab has been stuck in the queue with an import warning for two days — what happened?"

> "Tag every movie from A24 as 'arthouse' and move them to the 4K profile."

> "What's arriving on digital in the next month that I already have monitored?"

## Install

The package is published as
[`@orellbuehler/radarr-mcp`](https://www.npmjs.com/package/@orellbuehler/radarr-mcp) and runs
directly with `npx` — no clone or build needed:

```bash
claude mcp add radarr \
  --env RADARR_URL=http://radarr.local:7878 \
  --env RADARR_API_KEY=your-api-key \
  -- npx -y @orellbuehler/radarr-mcp
```

See [Usage with Claude Code](#usage-with-claude-code) for the equivalent JSON config. For any other
MCP client, run the package directly — `npx -y @orellbuehler/radarr-mcp` with `RADARR_URL` and
`RADARR_API_KEY` set in the environment. Requires Node.js 22+.

## Getting an API key

`RADARR_API_KEY` is Radarr's own API key: **Settings → General → Security → API Key**. It grants
full access to the instance, so treat it like a password. The server sends it only to the
configured host: redirects are refused rather than followed, so point `RADARR_URL` at the final URL
(for example `https://` if your reverse proxy redirects from `http://`).

## Configuration

| Variable         | Required | Description                                                                                                                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RADARR_URL`     | yes\*    | Base URL of your instance, e.g. `http://radarr.local:7878`. A reverse-proxy path such as `https://media.example.com/radarr` works; `/api/v3` is stripped if you include it. |
| `RADARR_SERVER`  | no       | Alias for `RADARR_URL`. Used if `RADARR_URL` is unset.                                                                                                                      |
| `RADARR_API_KEY` | yes      | Radarr API key.                                                                                                                                                             |

\* One of `RADARR_URL` or `RADARR_SERVER` is required. The server exits at startup if the URL or
the API key is missing.

## Tools

### Movies

| Tool            | Description                                                                              |
| --------------- | ---------------------------------------------------------------------------------------- |
| `list_movies`   | Compact library listing, filtered by search term, monitoring, file state, profile or tag |
| `get_movie`     | Full record for one movie                                                                |
| `lookup_movie`  | Search TMDB by term, IMDB id or TMDB id                                                  |
| `add_movie`     | Add a movie by TMDB id with root folder, profile and add options                         |
| `update_movie`  | Merge-update one movie (monitoring, profile, path, tags), optionally moving files        |
| `edit_movies`   | Bulk-edit monitoring, profile, availability, root folder and tags                        |
| `delete_movie`  | Remove one movie, optionally with its files                                              |
| `delete_movies` | Remove several movies in one call                                                        |

### Files

| Tool                            | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `list_movie_files`              | Files with quality, size, languages and media info           |
| `delete_movie_files`            | Delete files from disk, leaving the movies in the library    |
| `get_rename_preview`            | Which files the naming config would rename, and to what      |
| `list_manual_import_candidates` | Files found for a manual import, with matches and rejections |

### Searching and releases

| Tool                  | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `search_releases`     | Interactive indexer search with rejections and custom format scores |
| `grab_release`        | Send a release to the download client                               |
| `parse_release_title` | Ask Radarr how it parses a release title                            |

### Queue

| Tool                 | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| `get_queue`          | Paged queue with progress, warnings and import errors                       |
| `get_queue_status`   | Queue counters (errors, warnings, unknown items)                            |
| `remove_queue_items` | Remove items; removing from the download client and blocklisting are opt-in |
| `grab_queue_items`   | Force pending items through                                                 |

### Activity

| Tool                     | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `get_calendar`           | Upcoming cinema, digital and physical release dates          |
| `get_history`            | Paged global history of grabs, imports, failures and renames |
| `get_movie_history`      | Full history for one movie                                   |
| `mark_history_failed`    | Mark a grab failed, blocklist it and trigger a replacement   |
| `get_wanted`             | Missing or cutoff-unmet movies                               |
| `get_blocklist`          | Blocklisted releases with the reason                         |
| `remove_blocklist_items` | Unblock releases                                             |

### Commands

| Tool            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `run_command`   | Queue a command from the allowlist (searches, refresh, rescan, rename, syncs) |
| `list_commands` | Queued, running and recently finished commands                                |
| `get_command`   | Status of one command                                                         |

### Settings

| Tool                                       | Description                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `list_quality_profiles`                    | Profiles with cutoff and allowed qualities                              |
| `get_quality_profile`                      | One profile in full                                                     |
| `list_root_folders`                        | Root folders with free space and accessibility                          |
| `list_tags`                                | Tags, optionally with what uses them                                    |
| `create_tag` / `update_tag` / `delete_tag` | Tag management                                                          |
| `list_custom_formats`                      | Custom formats and their specifications                                 |
| `create_custom_format`                     | Create a custom format from specifications                              |
| `set_format_scores`                        | Set custom format scores and upgrade settings on a profile              |
| `list_quality_definitions`                 | Size limits per quality                                                 |
| `list_languages`                           | Language ids                                                            |
| `get_config`                               | Read a settings section (naming, media management, …), secrets redacted |
| `get_naming_examples`                      | Example names for the current naming config                             |

### Providers

| Tool                        | Description                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `list_indexers`             | Indexers with protocol, priority and settings (secrets redacted)              |
| `test_indexers`             | Test one or all indexers                                                      |
| `list_download_clients`     | Download clients (secrets redacted)                                           |
| `test_download_clients`     | Test one or all download clients                                              |
| `list_import_lists`         | Import lists with their monitor and profile settings                          |
| `test_import_lists`         | Test one or all import lists                                                  |
| `discover_movies`           | Import list suggestions plus recommended/trending/popular feeds               |
| `list_notifications`        | Notification connections and their events (secrets and webhook URLs redacted) |
| `list_remote_path_mappings` | Download client path → Radarr path mappings                                   |

### Collections and exclusions

| Tool                 | Description                                        |
| -------------------- | -------------------------------------------------- |
| `list_collections`   | TMDB collections with missing-movie counts         |
| `update_collections` | Bulk-update collection monitoring and add settings |
| `list_exclusions`    | Import list exclusions                             |
| `add_exclusion`      | Exclude a movie from import lists                  |
| `remove_exclusions`  | Remove exclusions                                  |

### System

| Tool                | Description                               |
| ------------------- | ----------------------------------------- |
| `get_system_status` | Version, branch, runtime, database, paths |
| `get_health`        | Active health warnings and errors         |
| `get_disk_space`    | Free and total space per drive            |
| `list_tasks`        | Scheduled tasks with last and next run    |
| `get_updates`       | Available Radarr updates                  |
| `get_logs`          | Paged log entries by level                |

## Scope

The server manages the library, not the host. There is deliberately no tool for restarting or
shutting down Radarr, restoring or deleting backups, deleting log files, or writing indexer,
download client and notification definitions — those stay in the Radarr UI. Provider settings are
readable and testable, and secrets are redacted from the responses: API keys, usernames, passwords,
passkeys, cookies, tokens, webhook URLs and credentials embedded in URLs (userinfo, `apikey=`/
`passkey=`-style query parameters, key-like path segments). `get_config` redacts the same way, so the
`host` section never returns Radarr's own API key or passwords. Redaction is best-effort pattern
matching — review the output before sharing a transcript.

Destructive library actions are available but never implicit: `delete_movie`, `delete_movies` and
`remove_queue_items` default their `delete_files`/`remove_from_client`/`blocklist` flags to off, and
`run_command` only accepts commands from an allowlist — a `name` passed through `params` is ignored.

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients
can auto-approve reads and ask before deletes.

## Usage with Claude Code

```json
{
  "mcpServers": {
    "radarr": {
      "command": "npx",
      "args": ["-y", "@orellbuehler/radarr-mcp"],
      "env": {
        "RADARR_URL": "http://radarr.local:7878",
        "RADARR_API_KEY": "your-api-key"
      }
    }
  }
}
```

Claude Desktop uses the same shape in `claude_desktop_config.json`.

## Development

```bash
npm install
npm test              # vitest
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run format:check  # prettier
npm run build         # tsc -> dist/
npm run spec:update   # refetch radarr-openapi.json from the Radarr repo
```

`radarr-openapi.json` is the vendored Radarr v3 API schema used as the reference when adding tools.

## License

MIT
