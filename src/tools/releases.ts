import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, buildQS, summarizeRelease, type Release } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { READ, WRITE } from "./annotations.js";

export function registerReleaseTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "search_releases",
    "Run an interactive indexer search for a movie and return the releases found, with their rejections and custom format scores. This queries every enabled indexer and can take a while. Grab one with grab_release.",
    {
      movie_id: z.number().int().describe("Radarr movie id to search releases for"),
      include_rejected: z
        .boolean()
        .optional()
        .describe("Include releases Radarr rejected, with the reasons (default true)"),
      limit: z.number().int().min(1).optional().describe("Return at most this many releases"),
    },
    READ,
    async ({ movie_id, include_rejected, limit }) => {
      try {
        const releases = (await client.fetch(
          `/api/v3/release${buildQS({ movieId: movie_id })}`,
        )) as Release[];
        let rows = releases;
        if (include_rejected === false) rows = rows.filter((r) => !r.rejected);
        const total = rows.length;
        if (limit !== undefined) rows = rows.slice(0, limit);
        return ok({ count: total, returned: rows.length, releases: rows.map(summarizeRelease) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "grab_release",
    "Send a release from search_releases to the download client. Radarr grabs it even if it was rejected, so check the rejections first.",
    {
      guid: z.string().describe("Release guid from search_releases"),
      indexer_id: z.number().int().describe("indexerId of the release from search_releases"),
      movie_id: z
        .number()
        .int()
        .optional()
        .describe("Movie id to import the release as (for releases Radarr could not map)"),
    },
    WRITE,
    async ({ guid, indexer_id, movie_id }) => {
      try {
        const body = {
          guid,
          indexerId: indexer_id,
          ...(movie_id !== undefined ? { movieId: movie_id, shouldOverride: true } : {}),
        };
        return ok(
          summarizeRelease((await client.json("/api/v3/release", "POST", body)) as Release),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "parse_release_title",
    "Ask Radarr to parse a release title: which movie, quality, languages, edition, release group and custom formats it maps to. Useful for diagnosing why a release is rejected or misidentified.",
    { title: z.string().describe("Release title, e.g. 'Movie.Name.2019.2160p.UHD.BluRay-GROUP'") },
    READ,
    async ({ title }) => {
      try {
        return ok(await client.fetch(`/api/v3/parse${buildQS({ title })}`));
      } catch (e) {
        return err(e);
      }
    },
  );
}
