# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A STDIO MCP server that exposes the Radarr v3 REST API as tools for AI agents: library curation,
indexer searches, queue triage and diagnostics. Published to npm as `@orellbuehler/radarr-mcp` and
run via `npx`; the compiled `dist/index.js` is the `bin` entry. See `README.md` for the tool catalog
and env-var reference.

## Commands

```bash
npm run build         # tsc -> dist/
npm test              # vitest run (all tests)
npm run test:watch    # vitest watch
npm run lint          # eslint src
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write .
npm run format:check  # prettier --check . (what CI runs)
npm run spec:update   # refetch radarr-openapi.json from the Radarr develop branch
```

Run a single test file or pattern:

```bash
npx vitest run src/__tests__/movies.test.ts
npx vitest run -t "delete_movie defaults"
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, and `test` in that order —
all must pass. The same four gates run locally on every commit via
[prek](https://github.com/j178/prek) pre-commit hooks (`.pre-commit-config.yaml`); run `prek install`
once per clone to enable them.

## Architecture

Request flow: `index.ts` reads config, builds the server via `server.ts:createServer(client)`, and
connects it over stdio. Every tool calls `client.fetch(...)` or `client.json(...)`.

- **`src/index.ts`** — entry point. Stdio transport only (single-user).
- **`src/config.ts`** — reads env at import time and **exits the process** if `RADARR_URL`/
  `RADARR_SERVER` or `RADARR_API_KEY` is missing. `normalizeBaseUrl` adds a scheme, drops trailing
  slashes and strips a trailing `/api` or `/api/v3` while **keeping a reverse-proxy path**
  (`https://media.example.com/radarr`).
- **`src/radarr/client.ts`** — `RadarrClient`, a thin `fetch` wrapper. Auth is the `X-Api-Key`
  header. `fetch()` returns JSON (or text; empty bodies become `{ success: true }`), `json()` is the
  body-carrying variant. Throws on non-2xx with the response body in the message. Default timeout is
  30s because interactive indexer searches are slow. Requests use `redirect: "error"` so the API key
  never follows a redirect to another host.
- **`src/radarr/format.ts`** — shared helpers: `buildQS` (**arrays are repeated, not comma-joined** —
  Radarr expects `movieIds=1&movieIds=2`), `ok`/`err` (MCP content envelopes; `ok` passes strings
  through unquoted), the `summarize*` functions plus `summarizePaged`, and the redaction helpers
  (`SECRET`, `redactUrl`, `redactValue`, `redactSecrets`).
- **`src/tools/*.ts`** — each exports a `register*Tools(server, client)` function that `server.ts`
  calls. Groups: `movies`, `files`, `queue`, `releases`, `activity` (calendar/history/wanted/
  blocklist), `commands`, `settings` (profiles, tags, config sections), `providers` (indexers,
  download clients, import lists, notifications), `library` (collections, exclusions), `system`.

## Conventions

- **ESM with Node16 module resolution: all relative imports must end in `.js`** (e.g.
  `import { ok } from "../radarr/format.js"`), even though the source is `.ts`.
- **Tool handler shape:** `server.tool(name, description, zodShape, annotations, async (args) => {
try { return ok(await client.fetch(...)); } catch (e) { return err(e); } })`. The third argument is a
  raw Zod shape object (`{}` when there are no params), the fourth one of the presets in
  `src/tools/annotations.ts` (`READ`, `WRITE`, `UPDATE`, `DESTRUCTIVE`, `DESTRUCTIVE_ONCE`);
  `server.test.ts` fails if a tool has none. Match this try/catch-`ok`/`err` style exactly.
- **Tool arguments are snake_case, Radarr's JSON is camelCase.** Map at the boundary in the handler.
- **Summarize list responses.** Radarr returns the entire library from `/api/v3/movie` and embeds a
  full `MovieResource` in queue, history and blocklist records; never pass those through raw. Add a
  `summarize*` helper instead, and keep `get_*` singular tools full-fidelity.
- **Bulk endpoints only for more than one id.** `remove_queue_items`, `delete_movie_files`,
  `remove_blocklist_items` and `remove_exclusions` take an id array and hit the single-item endpoint
  when there is exactly one — Radarr's `/bulk` routes take a JSON body on DELETE.
- **Don't add comments, docstrings, or type annotations** unless they already exist in the file
  you're editing (per global preference).
- **Scope is the library, not the host.** No restart/shutdown, no backup restore or delete, no log
  file deletion, and no create/update/delete for indexers, download clients or notifications — those
  are read-and-test only, and `safeFields` in `src/tools/providers.ts` redacts any field whose
  `privacy` is not `normal` or whose name matches the `SECRET` pattern, scrubs credentials out of
  URL values, and cuts notification URLs down to their origin. `get_config` runs every section
  through `redactSecrets`. `run_command` is limited to the `COMMANDS` allowlist in
  `src/tools/commands.ts`, and the allowlisted name always overrides `params`. Destructive library
  tools exist but default their `delete_files`/`remove_from_client`/`blocklist`/`addImportExclusion`
  flags to false.
- **Secrets:** the repo is public. Never log the API key; only read it from env. Tests use fake
  credentials.
- `radarr-openapi.json` (vendored from the Radarr `develop` branch, `npm run spec:update`) is the
  reference for what endpoints and fields exist — consult it when adding tools rather than guessing.

## Tests

Tests live in `src/__tests__/*.test.ts`. Tool tests pass a fake
`{ tool: (name, desc, schema, annotations, handler) => ... }` server to the `register*Tools` function to capture
handlers, then stub global `fetch` to assert the exact request URL, method and body plus the output
shaping. `config.ts` reads env at import time and exits if it's missing, so `config.test.ts`
`vi.stubEnv(...)` then dynamically `import()`s it, and resets modules between cases.
