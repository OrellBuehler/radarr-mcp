import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, buildQS } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";

interface MovieFile {
  id?: number;
  movieId?: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  releaseGroup?: string;
  edition?: string;
  sceneName?: string;
  qualityCutoffNotMet?: boolean;
  customFormatScore?: number;
  quality?: { quality?: { name?: string } };
  languages?: { name?: string }[];
  mediaInfo?: Record<string, unknown>;
}

function summarizeFile(f: MovieFile): Record<string, unknown> {
  const mi = f.mediaInfo ?? {};
  return {
    id: f.id,
    movieId: f.movieId,
    relativePath: f.relativePath,
    size: f.size,
    dateAdded: f.dateAdded,
    quality: f.quality?.quality?.name,
    qualityCutoffNotMet: f.qualityCutoffNotMet,
    customFormatScore: f.customFormatScore,
    releaseGroup: f.releaseGroup,
    edition: f.edition,
    languages: (f.languages ?? []).map((l) => l.name),
    resolution: mi.resolution,
    videoCodec: mi.videoCodec,
    audioCodec: mi.audioCodec,
    runTime: mi.runTime,
  };
}

export function registerFileTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "list_movie_files",
    "List the media files of one or more movies with quality, size, languages and media info. Pass movie ids, file ids, or neither for every file in the library.",
    {
      movie_ids: z.array(z.number().int()).optional().describe("Radarr movie ids"),
      movie_file_ids: z.array(z.number().int()).optional().describe("Specific movie file ids"),
    },
    async ({ movie_ids, movie_file_ids }) => {
      try {
        const files = (await client.fetch(
          `/api/v3/moviefile${buildQS({ movieId: movie_ids, movieFileIds: movie_file_ids })}`,
        )) as MovieFile[];
        return ok({ count: files.length, files: files.map(summarizeFile) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "delete_movie_files",
    "Delete movie files from disk. The movies stay in the library and, if monitored, become wanted again.",
    { ids: z.array(z.number().int()).min(1).describe("Movie file ids (from list_movie_files)") },
    async ({ ids }) => {
      try {
        if (ids.length === 1) {
          return ok(await client.fetch(`/api/v3/moviefile/${ids[0]}`, { method: "DELETE" }));
        }
        return ok(await client.json("/api/v3/moviefile/bulk", "DELETE", { movieFileIds: ids }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_rename_preview",
    "Preview how files would be renamed under the current naming configuration. Returns only files whose name would change; run the RenameFiles command to apply.",
    { movie_ids: z.array(z.number().int()).min(1).describe("Radarr movie ids to preview") },
    async ({ movie_ids }) => {
      try {
        const rows = (await client.fetch(`/api/v3/rename${buildQS({ movieId: movie_ids })}`)) as {
          movieId?: number;
          movieFileId?: number;
          existingPath?: string;
          newPath?: string;
        }[];
        return ok({ count: rows.length, renames: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_manual_import_candidates",
    "List files Radarr found for a manual import, with the movie it matched each one to, the parsed quality and any rejections. Use it to diagnose downloads stuck in the queue with an import warning.",
    {
      folder: z.string().optional().describe("Absolute folder path to scan"),
      download_id: z.string().optional().describe("Download id of a queue item to inspect"),
      movie_id: z.number().int().optional().describe("Movie to match the files against"),
      filter_existing_files: z
        .boolean()
        .optional()
        .describe("Hide files already in the library (default true)"),
    },
    async ({ folder, download_id, movie_id, filter_existing_files }) => {
      try {
        const qs = buildQS({
          folder,
          downloadId: download_id,
          movieId: movie_id,
          filterExistingFiles: filter_existing_files ?? true,
        });
        const rows = (await client.fetch(`/api/v3/manualimport${qs}`)) as {
          id?: number;
          path?: string;
          relativePath?: string;
          size?: number;
          movie?: { id?: number; title?: string; year?: number };
          quality?: { quality?: { name?: string } };
          rejections?: { reason?: string }[];
        }[];
        return ok({
          count: rows.length,
          files: rows.map((r) => ({
            id: r.id,
            path: r.path,
            relativePath: r.relativePath,
            size: r.size,
            movieId: r.movie?.id,
            movie: r.movie?.title ? `${r.movie.title} (${r.movie.year})` : undefined,
            quality: r.quality?.quality?.name,
            rejections: (r.rejections ?? []).map((x) => x.reason),
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );
}
