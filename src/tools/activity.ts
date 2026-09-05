import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ok,
  err,
  buildQS,
  summarizeMovie,
  summarizePaged,
  type Movie,
  type Paged,
} from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";

const EVENT_TYPES = [
  "unknown",
  "grabbed",
  "downloadFolderImported",
  "downloadFailed",
  "movieFileDeleted",
  "movieFolderImported",
  "movieFileRenamed",
  "downloadIgnored",
] as const;

interface HistoryRecord {
  id?: number;
  movieId?: number;
  sourceTitle?: string;
  eventType?: string;
  date?: string;
  downloadId?: string;
  quality?: { quality?: { name?: string } };
  customFormatScore?: number;
  data?: Record<string, unknown>;
  movie?: Movie;
}

function summarizeHistory(h: HistoryRecord): Record<string, unknown> {
  const data = h.data ?? {};
  const out: Record<string, unknown> = {
    id: h.id,
    movieId: h.movieId,
    eventType: h.eventType,
    date: h.date,
    sourceTitle: h.sourceTitle,
    quality: h.quality?.quality?.name,
  };
  if (h.movie?.title) out.movie = `${h.movie.title} (${h.movie.year})`;
  if (h.downloadId) out.downloadId = h.downloadId;
  for (const key of [
    "indexer",
    "downloadClient",
    "reason",
    "message",
    "droppedPath",
    "importedPath",
  ])
    if (data[key] !== undefined) out[key] = data[key];
  return out;
}

interface BlocklistRecord {
  id?: number;
  movieId?: number;
  sourceTitle?: string;
  date?: string;
  protocol?: string;
  indexer?: string;
  message?: string;
  quality?: { quality?: { name?: string } };
}

function summarizeBlocklist(b: BlocklistRecord): Record<string, unknown> {
  return {
    id: b.id,
    movieId: b.movieId,
    sourceTitle: b.sourceTitle,
    date: b.date,
    protocol: b.protocol,
    indexer: b.indexer,
    message: b.message,
    quality: b.quality?.quality?.name,
  };
}

export function registerActivityTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "get_calendar",
    "List movies with a release date in a window: cinema, digital and physical release dates plus whether the file is already on disk. Defaults to the next 30 days.",
    {
      start: z.string().optional().describe("Start date, ISO 8601, e.g. '2026-01-01'"),
      end: z.string().optional().describe("End date, ISO 8601"),
      unmonitored: z.boolean().optional().describe("Include unmonitored movies (default false)"),
      tags: z.string().optional().describe("Comma-separated tag ids to filter by"),
    },
    async ({ start, end, unmonitored, tags }) => {
      try {
        const movies = (await client.fetch(
          `/api/v3/calendar${buildQS({ start, end, unmonitored, tags })}`,
        )) as Movie[];
        return ok({
          count: movies.length,
          movies: movies.map((m) => ({
            ...summarizeMovie(m),
            inCinemas: m.inCinemas,
            digitalRelease: m.digitalRelease,
            physicalRelease: m.physicalRelease,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_history",
    "Page through the global history: grabs, imports, failures, deletions and renames, newest first by default. Filter by event type, movie or download id to trace what happened to a specific download.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Items per page (default 20)"),
      sort_key: z.string().optional().describe("Sort field (default 'date')"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
      event_type: z.array(z.enum(EVENT_TYPES)).optional().describe("Only these event types"),
      movie_ids: z.array(z.number().int()).optional().describe("Only these movie ids"),
      download_id: z.string().optional().describe("Only records for this download id"),
    },
    async ({ page, page_size, sort_key, sort_direction, event_type, movie_ids, download_id }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          sortKey: sort_key ?? "date",
          sortDirection: sort_direction ?? "descending",
          eventType: event_type,
          movieIds: movie_ids,
          downloadId: download_id,
          includeMovie: true,
        });
        const res = (await client.fetch(`/api/v3/history${qs}`)) as Paged<HistoryRecord>;
        return ok(summarizePaged(res, summarizeHistory));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_movie_history",
    "Get the full, unpaged history for one movie: every grab, import, rename and failure. Use this to explain why a movie has the file it has.",
    {
      movie_id: z.number().int().describe("Radarr movie id"),
      event_type: z.enum(EVENT_TYPES).optional().describe("Only this event type"),
    },
    async ({ movie_id, event_type }) => {
      try {
        const records = (await client.fetch(
          `/api/v3/history/movie${buildQS({ movieId: movie_id, eventType: event_type })}`,
        )) as HistoryRecord[];
        return ok({ count: records.length, records: records.map(summarizeHistory) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "mark_history_failed",
    "Mark a grabbed history record as failed. Radarr blocklists the release and, if the movie is still monitored, searches for a replacement.",
    { id: z.number().int().describe("History record id (from get_history)") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/v3/history/failed/${id}`, { method: "POST" }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_wanted",
    "List wanted movies: 'missing' are monitored movies with no file, 'cutoff' are movies whose file is below the quality profile cutoff.",
    {
      kind: z.enum(["missing", "cutoff"]).describe("Which wanted list to read"),
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Items per page (default 20)"),
      sort_key: z.string().optional().describe("Sort field, e.g. 'title', 'digitalRelease'"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
      monitored: z
        .boolean()
        .optional()
        .describe("Only monitored (true, the default) or unmonitored (false) movies"),
    },
    async ({ kind, page, page_size, sort_key, sort_direction, monitored }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          sortKey: sort_key,
          sortDirection: sort_direction,
          monitored,
        });
        const res = (await client.fetch(`/api/v3/wanted/${kind}${qs}`)) as Paged<Movie>;
        return ok(summarizePaged(res, summarizeMovie));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_blocklist",
    "List blocklisted releases: what was blocked, when, from which indexer and why. Releases land here after a failed download or an explicit blocklist.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Items per page (default 20)"),
      sort_key: z.string().optional().describe("Sort field (default 'date')"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
      movie_ids: z.array(z.number().int()).optional().describe("Only these movie ids"),
    },
    async ({ page, page_size, sort_key, sort_direction, movie_ids }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          sortKey: sort_key ?? "date",
          sortDirection: sort_direction ?? "descending",
          movieIds: movie_ids,
        });
        const res = (await client.fetch(`/api/v3/blocklist${qs}`)) as Paged<BlocklistRecord>;
        return ok(summarizePaged(res, summarizeBlocklist));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "remove_blocklist_items",
    "Remove entries from the blocklist so those releases can be grabbed again.",
    { ids: z.array(z.number().int()).min(1).describe("Blocklist ids (from get_blocklist)") },
    async ({ ids }) => {
      try {
        if (ids.length === 1) {
          return ok(await client.fetch(`/api/v3/blocklist/${ids[0]}`, { method: "DELETE" }));
        }
        return ok(await client.json("/api/v3/blocklist/bulk", "DELETE", { ids }));
      } catch (e) {
        return err(e);
      }
    },
  );
}
