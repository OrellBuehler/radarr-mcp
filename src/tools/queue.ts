import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ok,
  err,
  buildQS,
  summarizeQueueItem,
  summarizePaged,
  type Paged,
  type QueueItem,
} from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";

const QUEUE_STATUS = [
  "unknown",
  "queued",
  "paused",
  "downloading",
  "completed",
  "failed",
  "warning",
  "delay",
  "downloadClientUnavailable",
  "fallback",
] as const;

export function registerQueueTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "get_queue",
    "List the download queue as a compact summary: what is downloading, how much is left, and any import warnings or errors. Stalled or failed imports show up in trackedDownloadStatus/statusMessages.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Items per page (default 20)"),
      sort_key: z
        .string()
        .optional()
        .describe("Sort field, e.g. 'timeleft', 'progress', 'estimatedCompletionTime'"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
      movie_ids: z.array(z.number().int()).optional().describe("Only items for these movie ids"),
      status: z.array(z.enum(QUEUE_STATUS)).optional().describe("Only items in these queue states"),
      protocol: z.enum(["unknown", "usenet", "torrent"]).optional(),
      include_unknown_movie_items: z
        .boolean()
        .optional()
        .describe("Include downloads Radarr could not map to a movie (default true)"),
    },
    async ({
      page,
      page_size,
      sort_key,
      sort_direction,
      movie_ids,
      status,
      protocol,
      include_unknown_movie_items,
    }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          sortKey: sort_key,
          sortDirection: sort_direction,
          movieIds: movie_ids,
          status,
          protocol,
          includeMovie: true,
          includeUnknownMovieItems: include_unknown_movie_items ?? true,
        });
        const res = (await client.fetch(`/api/v3/queue${qs}`)) as Paged<QueueItem>;
        return ok(summarizePaged(res, summarizeQueueItem));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_queue_status",
    "Get queue counters: total, errors, warnings, unknown items and whether anything needs manual import. Cheap health check before pulling the full queue.",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/v3/queue/status"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "remove_queue_items",
    "Remove one or more items from the queue. By default the download is also removed from the download client; set blocklist to stop the same release being grabbed again, and skip_redownload to not search for a replacement.",
    {
      ids: z.array(z.number().int()).min(1).describe("Queue item ids (from get_queue)"),
      remove_from_client: z
        .boolean()
        .optional()
        .describe("Also remove the download from the download client (default true)"),
      blocklist: z
        .boolean()
        .optional()
        .describe("Blocklist the release so it is not grabbed again (default false)"),
      skip_redownload: z
        .boolean()
        .optional()
        .describe("Do not search for a replacement release (default false)"),
      change_category: z
        .boolean()
        .optional()
        .describe("Move the download to the post-import category instead of deleting it"),
    },
    async ({ ids, remove_from_client, blocklist, skip_redownload, change_category }) => {
      try {
        const qs = buildQS({
          removeFromClient: remove_from_client ?? true,
          blocklist: blocklist ?? false,
          skipRedownload: skip_redownload ?? false,
          changeCategory: change_category,
        });
        if (ids.length === 1) {
          return ok(await client.fetch(`/api/v3/queue/${ids[0]}${qs}`, { method: "DELETE" }));
        }
        return ok(await client.json(`/api/v3/queue/bulk${qs}`, "DELETE", { ids }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "grab_queue_items",
    "Force Radarr to import queue items that are waiting in the 'pending' state (for example releases held by a delay profile).",
    { ids: z.array(z.number().int()).min(1).describe("Queue item ids (from get_queue)") },
    async ({ ids }) => {
      try {
        if (ids.length === 1) {
          return ok(await client.fetch(`/api/v3/queue/grab/${ids[0]}`, { method: "POST" }));
        }
        return ok(await client.json("/api/v3/queue/grab/bulk", "POST", { ids }));
      } catch (e) {
        return err(e);
      }
    },
  );
}
