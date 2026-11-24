import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, buildQS, summarizeMovie, summarizeLookup, type Movie } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { DESTRUCTIVE, READ, UPDATE, WRITE } from "./annotations.js";

const MOVIE_STATUS = ["tba", "announced", "inCinemas", "released", "deleted"] as const;
const MONITOR_TYPES = ["movieOnly", "movieAndCollection", "none"] as const;

export function registerMovieTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "list_movies",
    "List movies in the library as a compact summary (id, title, year, tmdbId, monitored, hasFile, status, quality, path, tags). Use get_movie for the full record. Filters are applied client-side because Radarr returns the whole library in one response.",
    {
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring matched against title and original title"),
      monitored: z.boolean().optional().describe("Only monitored (true) or unmonitored (false)"),
      has_file: z
        .boolean()
        .optional()
        .describe("Only movies with a file on disk (true) or missing (false)"),
      quality_profile_id: z
        .number()
        .int()
        .optional()
        .describe("Only movies on this quality profile"),
      tag_id: z.number().int().optional().describe("Only movies carrying this tag id"),
      limit: z.number().int().min(1).optional().describe("Return at most this many movies"),
    },
    READ,
    async ({ search, monitored, has_file, quality_profile_id, tag_id, limit }) => {
      try {
        const movies = (await client.fetch("/api/v3/movie?excludeLocalCovers=true")) as (Movie & {
          originalTitle?: string;
        })[];
        let rows = movies;
        if (search) {
          const q = search.toLowerCase();
          rows = rows.filter(
            (m) =>
              (m.title ?? "").toLowerCase().includes(q) ||
              (m.originalTitle ?? "").toLowerCase().includes(q),
          );
        }
        if (monitored !== undefined) rows = rows.filter((m) => m.monitored === monitored);
        if (has_file !== undefined) rows = rows.filter((m) => m.hasFile === has_file);
        if (quality_profile_id !== undefined)
          rows = rows.filter((m) => m.qualityProfileId === quality_profile_id);
        if (tag_id !== undefined) rows = rows.filter((m) => (m.tags ?? []).includes(tag_id));
        const total = rows.length;
        if (limit !== undefined) rows = rows.slice(0, limit);
        return ok({ count: total, returned: rows.length, movies: rows.map(summarizeMovie) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_movie",
    "Get the full record for one movie in the library: file details, ratings, images, availability, statistics and add options.",
    { id: z.number().int().describe("Radarr movie id (not the TMDB id)") },
    READ,
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/v3/movie/${id}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "lookup_movie",
    "Search TMDB for movies by free-text term, IMDB id or TMDB id. Returns candidates with their tmdbId, which is what add_movie needs. Results already in the library carry a Radarr `id`.",
    {
      term: z.string().optional().describe("Free-text search term, e.g. 'blade runner 2049'"),
      imdb_id: z.string().optional().describe("IMDB id, e.g. 'tt1856101'"),
      tmdb_id: z.number().int().optional().describe("TMDB id, e.g. 335984"),
    },
    READ,
    async ({ term, imdb_id, tmdb_id }) => {
      try {
        if (tmdb_id !== undefined) {
          const movie = (await client.fetch(
            `/api/v3/movie/lookup/tmdb${buildQS({ tmdbId: tmdb_id })}`,
          )) as Movie;
          return ok({ count: 1, results: [summarizeLookup(movie)] });
        }
        if (imdb_id) {
          const movie = (await client.fetch(
            `/api/v3/movie/lookup/imdb${buildQS({ imdbId: imdb_id })}`,
          )) as Movie;
          return ok({ count: 1, results: [summarizeLookup(movie)] });
        }
        if (!term) throw new Error("Provide one of term, imdb_id or tmdb_id");
        const results = (await client.fetch(`/api/v3/movie/lookup${buildQS({ term })}`)) as Movie[];
        return ok({ count: results.length, results: results.map(summarizeLookup) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "add_movie",
    "Add a movie to the library by TMDB id. Looks the movie up first, then posts it with the given root folder and quality profile. Use list_root_folders and list_quality_profiles to pick valid values, and lookup_movie to find the tmdbId.",
    {
      tmdb_id: z.number().int().describe("TMDB id of the movie to add"),
      root_folder_path: z
        .string()
        .describe("Root folder to store the movie in, e.g. '/movies' (see list_root_folders)"),
      quality_profile_id: z
        .number()
        .int()
        .describe("Quality profile id (see list_quality_profiles)"),
      monitored: z.boolean().optional().describe("Monitor the movie (default true)"),
      minimum_availability: z
        .enum(MOVIE_STATUS)
        .optional()
        .describe("When Radarr may start searching (default 'released')"),
      monitor: z
        .enum(MONITOR_TYPES)
        .optional()
        .describe("What to monitor on add (default 'movieOnly')"),
      search_for_movie: z
        .boolean()
        .optional()
        .describe("Immediately run an indexer search after adding (default true)"),
      tags: z.array(z.number().int()).optional().describe("Tag ids to apply"),
    },
    WRITE,
    async ({
      tmdb_id,
      root_folder_path,
      quality_profile_id,
      monitored,
      minimum_availability,
      monitor,
      search_for_movie,
      tags,
    }) => {
      try {
        const lookup = (await client.fetch(
          `/api/v3/movie/lookup/tmdb${buildQS({ tmdbId: tmdb_id })}`,
        )) as Record<string, unknown>;
        const body = {
          ...lookup,
          rootFolderPath: root_folder_path,
          qualityProfileId: quality_profile_id,
          monitored: monitored ?? true,
          minimumAvailability: minimum_availability ?? "released",
          tags: tags ?? [],
          addOptions: {
            monitor: monitor ?? "movieOnly",
            searchForMovie: search_for_movie ?? true,
          },
        };
        const added = (await client.json("/api/v3/movie", "POST", body)) as Movie;
        return ok(summarizeMovie(added));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "update_movie",
    "Update one movie's settings. Reads the current record, merges the given fields and puts it back, so unspecified fields are preserved. Set move_files when changing path or root folder to have Radarr relocate the existing files.",
    {
      id: z.number().int().describe("Radarr movie id"),
      monitored: z.boolean().optional().describe("Monitor or unmonitor the movie"),
      quality_profile_id: z.number().int().optional().describe("New quality profile id"),
      minimum_availability: z.enum(MOVIE_STATUS).optional().describe("New minimum availability"),
      root_folder_path: z.string().optional().describe("New root folder path"),
      path: z.string().optional().describe("New absolute movie folder path"),
      tags: z.array(z.number().int()).optional().describe("Replace the tag ids with this list"),
      move_files: z
        .boolean()
        .optional()
        .describe("Move existing files to the new location (default false)"),
    },
    UPDATE,
    async ({
      id,
      monitored,
      quality_profile_id,
      minimum_availability,
      root_folder_path,
      path,
      tags,
      move_files,
    }) => {
      try {
        const current = (await client.fetch(`/api/v3/movie/${id}`)) as Record<string, unknown>;
        const body = {
          ...current,
          ...(monitored !== undefined ? { monitored } : {}),
          ...(quality_profile_id !== undefined ? { qualityProfileId: quality_profile_id } : {}),
          ...(minimum_availability !== undefined
            ? { minimumAvailability: minimum_availability }
            : {}),
          ...(root_folder_path !== undefined ? { rootFolderPath: root_folder_path } : {}),
          ...(path !== undefined ? { path } : {}),
          ...(tags !== undefined ? { tags } : {}),
        };
        const updated = (await client.json(
          `/api/v3/movie/${id}${buildQS({ moveFiles: move_files })}`,
          "PUT",
          body,
        )) as Movie;
        return ok(summarizeMovie(updated));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "delete_movie",
    "Remove a movie from the library. Files are kept unless delete_files is set. Set add_import_exclusion to stop import lists from re-adding it.",
    {
      id: z.number().int().describe("Radarr movie id"),
      delete_files: z
        .boolean()
        .optional()
        .describe("Also delete the movie folder and its files from disk (default false)"),
      add_import_exclusion: z
        .boolean()
        .optional()
        .describe("Add the movie to the import list exclusions (default false)"),
    },
    DESTRUCTIVE,
    async ({ id, delete_files, add_import_exclusion }) => {
      try {
        return ok(
          await client.fetch(
            `/api/v3/movie/${id}${buildQS({
              deleteFiles: delete_files ?? false,
              addImportExclusion: add_import_exclusion ?? false,
            })}`,
            { method: "DELETE" },
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "edit_movies",
    "Bulk-edit movies: monitoring, quality profile, minimum availability, root folder and tags in one call. Only the given fields change. apply_tags controls whether the tag ids are added, removed or replace the existing ones.",
    {
      movie_ids: z.array(z.number().int()).min(1).describe("Radarr movie ids to edit"),
      monitored: z.boolean().optional().describe("Monitor or unmonitor all of them"),
      quality_profile_id: z.number().int().optional().describe("New quality profile id"),
      minimum_availability: z.enum(MOVIE_STATUS).optional().describe("New minimum availability"),
      root_folder_path: z.string().optional().describe("New root folder path"),
      tags: z.array(z.number().int()).optional().describe("Tag ids to apply per apply_tags"),
      apply_tags: z
        .enum(["add", "remove", "replace"])
        .optional()
        .describe("How to apply `tags` (default 'add')"),
      move_files: z
        .boolean()
        .optional()
        .describe("Move files when changing the root folder (default false)"),
    },
    UPDATE,
    async ({
      movie_ids,
      monitored,
      quality_profile_id,
      minimum_availability,
      root_folder_path,
      tags,
      apply_tags,
      move_files,
    }) => {
      try {
        const body = {
          movieIds: movie_ids,
          ...(monitored !== undefined ? { monitored } : {}),
          ...(quality_profile_id !== undefined ? { qualityProfileId: quality_profile_id } : {}),
          ...(minimum_availability !== undefined
            ? { minimumAvailability: minimum_availability }
            : {}),
          ...(root_folder_path !== undefined ? { rootFolderPath: root_folder_path } : {}),
          ...(tags !== undefined ? { tags, applyTags: apply_tags ?? "add" } : {}),
          ...(move_files !== undefined ? { moveFiles: move_files } : {}),
        };
        const rows = (await client.json("/api/v3/movie/editor", "PUT", body)) as Movie[];
        return ok({ updated: rows.length, movies: rows.slice(0, 25).map(summarizeMovie) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "delete_movies",
    "Remove several movies from the library in one call. Files are kept unless delete_files is set.",
    {
      movie_ids: z.array(z.number().int()).min(1).describe("Radarr movie ids to remove"),
      delete_files: z
        .boolean()
        .optional()
        .describe("Also delete their folders and files from disk (default false)"),
      add_import_exclusion: z
        .boolean()
        .optional()
        .describe("Add them to the import list exclusions (default false)"),
    },
    DESTRUCTIVE,
    async ({ movie_ids, delete_files, add_import_exclusion }) => {
      try {
        return ok(
          await client.json("/api/v3/movie/editor", "DELETE", {
            movieIds: movie_ids,
            deleteFiles: delete_files ?? false,
            addImportExclusion: add_import_exclusion ?? false,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
