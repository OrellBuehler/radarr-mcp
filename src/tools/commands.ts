import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { DESTRUCTIVE_ONCE, READ } from "./annotations.js";

export const COMMANDS = [
  "MoviesSearch",
  "MissingMoviesSearch",
  "CutoffUnmetMoviesSearch",
  "RefreshMovie",
  "RefreshCollections",
  "RescanMovie",
  "RenameMovie",
  "RenameFiles",
  "DownloadedMoviesScan",
  "ImportListSync",
  "RssSync",
  "RefreshMonitoredDownloads",
  "CheckHealth",
  "Housekeeping",
  "ApplicationUpdateCheck",
  "ClearBlocklist",
  "Backup",
] as const;

const RESERVED = new Set(["name", "commandname"]);

interface CommandRecord {
  id?: number;
  name?: string;
  commandName?: string;
  message?: string;
  status?: string;
  result?: string;
  queued?: string;
  started?: string;
  ended?: string;
  duration?: string;
  exception?: string;
  trigger?: string;
}

function summarizeCommand(c: CommandRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: c.id,
    name: c.name,
    commandName: c.commandName,
    status: c.status,
    result: c.result,
    queued: c.queued,
    started: c.started,
    ended: c.ended,
    duration: c.duration,
    trigger: c.trigger,
  };
  if (c.message) out.message = c.message;
  if (c.exception) out.exception = c.exception;
  return out;
}

export function registerCommandTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "run_command",
    `Queue a Radarr command. Commands run asynchronously — the response carries an id to poll with get_command. Allowed: ${COMMANDS.join(", ")}. 'MoviesSearch', 'RefreshMovie', 'RescanMovie', 'RenameMovie' and 'RenameFiles' take movie_ids; the rest take none.`,
    {
      name: z.enum(COMMANDS).describe("Command name"),
      movie_ids: z
        .array(z.number().int())
        .optional()
        .describe("Radarr movie ids for the commands that operate on movies"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Extra command body fields (e.g. { files: [1, 2] } for RenameFiles). A 'name' key is ignored: the command is always the allowlisted name",
        ),
    },
    DESTRUCTIVE_ONCE,
    async ({ name, movie_ids, params }) => {
      try {
        const extra = Object.fromEntries(
          Object.entries(params ?? {}).filter(([key]) => !RESERVED.has(key.toLowerCase())),
        );
        const body: Record<string, unknown> = { ...extra, name };
        if (movie_ids?.length) {
          body.movieIds = movie_ids;
          if (name === "RescanMovie" || name === "RenameFiles") body.movieId = movie_ids[0];
        }
        const res = (await client.json("/api/v3/command", "POST", body)) as CommandRecord;
        return ok(summarizeCommand(res));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_commands",
    "List queued, started and recently finished commands with their status and result. Use it to check whether a search or refresh has completed.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/command")) as CommandRecord[];
        return ok({ count: rows.length, commands: rows.map(summarizeCommand) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_command",
    "Get the status of one command by id, including its result and any exception.",
    { id: z.number().int().describe("Command id returned by run_command") },
    READ,
    async ({ id }) => {
      try {
        return ok(summarizeCommand((await client.fetch(`/api/v3/command/${id}`)) as CommandRecord));
      } catch (e) {
        return err(e);
      }
    },
  );
}
