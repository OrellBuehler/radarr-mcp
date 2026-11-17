import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, buildQS, summarizePaged, type Paged } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { READ } from "./annotations.js";

export function registerSystemTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "get_system_status",
    "Get version, branch, runtime, database, install path and package details. Also serves as a connectivity and API key check.",
    {},
    READ,
    async () => {
      try {
        return ok(await client.fetch("/api/v3/system/status"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_health",
    "List active health check warnings and errors with the wiki link explaining each one. Empty means Radarr considers itself healthy.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/health")) as unknown[];
        return ok({ count: rows.length, issues: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_disk_space",
    "List free and total space for every drive Radarr can see, including the root folders.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/diskspace")) as unknown[];
        return ok({ count: rows.length, disks: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_tasks",
    "List scheduled tasks with their interval, last execution and next run. Shows whether RSS sync, refresh and housekeeping are actually running.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/system/task")) as unknown[];
        return ok({ count: rows.length, tasks: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_updates",
    "List available Radarr updates with their version, release date and changelog.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/update")) as unknown[];
        return ok({ count: rows.length, updates: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_logs",
    "Page through Radarr's log entries, newest first. Filter by level to find the error behind a failed grab or import.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Entries per page (default 20)"),
      level: z
        .enum(["trace", "debug", "info", "warn", "error", "fatal"])
        .optional()
        .describe("Only entries at this level"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
    },
    READ,
    async ({ page, page_size, level, sort_direction }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          level,
          sortKey: "time",
          sortDirection: sort_direction ?? "descending",
        });
        const res = (await client.fetch(`/api/v3/log${qs}`)) as Paged<Record<string, unknown>>;
        return ok(
          summarizePaged(res, (r) => ({
            time: r.time,
            level: r.level,
            logger: r.logger,
            message: r.message,
            exceptionType: r.exceptionType,
            exception: r.exception,
          })),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
