import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, buildQS } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { DESTRUCTIVE, READ, UPDATE, WRITE } from "./annotations.js";

const MOVIE_STATUS = ["tba", "announced", "inCinemas", "released", "deleted"] as const;

interface Collection {
  id?: number;
  title?: string;
  tmdbId?: number;
  monitored?: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  minimumAvailability?: string;
  searchOnAdd?: boolean;
  missingMovies?: number;
  tags?: number[];
  movies?: { tmdbId?: number; title?: string; year?: number; isExisting?: boolean }[];
}

export function registerLibraryTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "list_collections",
    "List TMDB collections Radarr knows about, with how many of their movies are still missing from the library.",
    {
      include_movies: z
        .boolean()
        .optional()
        .describe("Include each collection's movie list (default false)"),
    },
    READ,
    async ({ include_movies }) => {
      try {
        const rows = (await client.fetch("/api/v3/collection")) as Collection[];
        return ok({
          count: rows.length,
          collections: rows.map((c) => ({
            id: c.id,
            title: c.title,
            tmdbId: c.tmdbId,
            monitored: c.monitored,
            missingMovies: c.missingMovies,
            qualityProfileId: c.qualityProfileId,
            rootFolderPath: c.rootFolderPath,
            searchOnAdd: c.searchOnAdd,
            movieCount: (c.movies ?? []).length,
            ...(include_movies
              ? {
                  movies: (c.movies ?? []).map((m) => ({
                    tmdbId: m.tmdbId,
                    title: m.title,
                    year: m.year,
                    isExisting: m.isExisting,
                  })),
                }
              : {}),
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "update_collections",
    "Update collections in bulk: monitoring, whether new collection movies are added and searched, and the profile and root folder they are added with.",
    {
      collection_ids: z.array(z.number().int()).min(1).describe("Collection ids"),
      monitored: z.boolean().optional().describe("Monitor the collections themselves"),
      monitor_movies: z
        .boolean()
        .optional()
        .describe("Add and monitor the collection's movies in the library"),
      search_on_add: z.boolean().optional().describe("Search for movies as they are added"),
      quality_profile_id: z.number().int().optional().describe("Quality profile for added movies"),
      root_folder_path: z.string().optional().describe("Root folder for added movies"),
      minimum_availability: z
        .enum(MOVIE_STATUS)
        .optional()
        .describe("Minimum availability for added movies"),
    },
    UPDATE,
    async ({
      collection_ids,
      monitored,
      monitor_movies,
      search_on_add,
      quality_profile_id,
      root_folder_path,
      minimum_availability,
    }) => {
      try {
        const body = {
          collectionIds: collection_ids,
          ...(monitored !== undefined ? { monitored } : {}),
          ...(monitor_movies !== undefined ? { monitorMovies: monitor_movies } : {}),
          ...(search_on_add !== undefined ? { searchOnAdd: search_on_add } : {}),
          ...(quality_profile_id !== undefined ? { qualityProfileId: quality_profile_id } : {}),
          ...(root_folder_path !== undefined ? { rootFolderPath: root_folder_path } : {}),
          ...(minimum_availability !== undefined
            ? { minimumAvailability: minimum_availability }
            : {}),
        };
        return ok(await client.json("/api/v3/collection", "PUT", body));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_exclusions",
    "List import list exclusions — movies import lists are not allowed to add back.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      page_size: z.number().int().min(1).optional().describe("Items per page (default 20)"),
      sort_key: z.string().optional().describe("Sort field, e.g. 'movieTitle'"),
      sort_direction: z.enum(["default", "ascending", "descending"]).optional(),
    },
    READ,
    async ({ page, page_size, sort_key, sort_direction }) => {
      try {
        const qs = buildQS({
          page,
          pageSize: page_size,
          sortKey: sort_key,
          sortDirection: sort_direction,
        });
        return ok(await client.fetch(`/api/v3/exclusions/paged${qs}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "add_exclusion",
    "Exclude a movie from import lists by TMDB id so lists stop re-adding it. Deleting a movie with add_import_exclusion does the same thing.",
    {
      tmdb_id: z.number().int().describe("TMDB id of the movie to exclude"),
      movie_title: z.string().describe("Movie title, shown in the exclusions list"),
      movie_year: z.number().int().describe("Movie year"),
    },
    WRITE,
    async ({ tmdb_id, movie_title, movie_year }) => {
      try {
        return ok(
          await client.json("/api/v3/exclusions", "POST", {
            tmdbId: tmdb_id,
            movieTitle: movie_title,
            movieYear: movie_year,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "remove_exclusions",
    "Remove import list exclusions so lists may add those movies again.",
    { ids: z.array(z.number().int()).min(1).describe("Exclusion ids (from list_exclusions)") },
    DESTRUCTIVE,
    async ({ ids }) => {
      try {
        if (ids.length === 1) {
          return ok(await client.fetch(`/api/v3/exclusions/${ids[0]}`, { method: "DELETE" }));
        }
        return ok(await client.json("/api/v3/exclusions/bulk", "DELETE", { ids }));
      } catch (e) {
        return err(e);
      }
    },
  );
}
