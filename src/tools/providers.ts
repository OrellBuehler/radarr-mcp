import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ok,
  err,
  buildQS,
  summarizeLookup,
  redactValue,
  REDACTED,
  type Movie,
} from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { READ } from "./annotations.js";

interface Field {
  name?: string;
  label?: string;
  value?: unknown;
  privacy?: string;
}

interface Provider {
  id?: number;
  name?: string;
  implementation?: string;
  implementationName?: string;
  configContract?: string;
  enable?: boolean;
  enabled?: boolean;
  enableRss?: boolean;
  enableAutomaticSearch?: boolean;
  enableInteractiveSearch?: boolean;
  enableAuto?: boolean;
  protocol?: string;
  priority?: number;
  tags?: number[];
  fields?: Field[];
  monitor?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  minimumAvailability?: string;
  searchOnAdd?: boolean;
  listType?: string;
  onGrab?: boolean;
  onDownload?: boolean;
  onUpgrade?: boolean;
  onMovieDelete?: boolean;
  onHealthIssue?: boolean;
  removeCompletedDownloads?: boolean;
  removeFailedDownloads?: boolean;
}

const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i;

function originOnly(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const origin = URL_VALUE.exec(value)?.[0];
  if (!origin || origin.length >= value.replace(/\/$/, "").length) return value;
  return `${origin}/${REDACTED}`;
}

function safeFields(fields: Field[] = [], strictUrls = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.name || f.value === undefined || f.value === null || f.value === "") continue;
    const value = f.privacy && f.privacy !== "normal" ? REDACTED : redactValue(f.name, f.value);
    out[f.name] = strictUrls ? originOnly(value) : value;
  }
  return out;
}

function summarizeProvider(p: Provider, strictUrls = false): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    implementation: p.implementation,
    fields: safeFields(p.fields, strictUrls),
  };
  for (const key of [
    "enable",
    "enabled",
    "enableRss",
    "enableAutomaticSearch",
    "enableInteractiveSearch",
    "enableAuto",
    "protocol",
    "priority",
    "monitor",
    "rootFolderPath",
    "qualityProfileId",
    "minimumAvailability",
    "searchOnAdd",
    "listType",
    "onGrab",
    "onDownload",
    "onUpgrade",
    "onMovieDelete",
    "onHealthIssue",
    "removeCompletedDownloads",
    "removeFailedDownloads",
  ] as const) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  if (p.tags?.length) out.tags = p.tags;
  return out;
}

async function listProviders(client: RadarrClient, path: string, key: string, strictUrls = false) {
  const rows = (await client.fetch(path)) as Provider[];
  return ok({ count: rows.length, [key]: rows.map((p) => summarizeProvider(p, strictUrls)) });
}

async function testProviders(client: RadarrClient, path: string, id?: number) {
  if (id === undefined) return ok(await client.fetch(`${path}/testall`, { method: "POST" }));
  const provider = await client.fetch(`${path}/${id}`);
  return ok(await client.json(`${path}/test`, "POST", provider));
}

export function registerProviderTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "list_indexers",
    "List configured indexers: protocol, priority, which search modes are enabled and their settings. API keys, passwords, passkeys, cookies and credentials embedded in URLs are redacted.",
    {},
    READ,
    async () => {
      try {
        return await listProviders(client, "/api/v3/indexer", "indexers");
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "test_indexers",
    "Test indexer connectivity. Without an id every indexer is tested. Run this when searches return nothing.",
    { id: z.number().int().optional().describe("Indexer id; omit to test all") },
    READ,
    async ({ id }) => {
      try {
        return await testProviders(client, "/api/v3/indexer", id);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_download_clients",
    "List configured download clients with their category, priority and removal settings. Credentials are redacted.",
    {},
    READ,
    async () => {
      try {
        return await listProviders(client, "/api/v3/downloadclient", "downloadClients");
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "test_download_clients",
    "Test download client connectivity. Without an id every client is tested. Run this when grabs never reach the queue.",
    { id: z.number().int().optional().describe("Download client id; omit to test all") },
    READ,
    async ({ id }) => {
      try {
        return await testProviders(client, "/api/v3/downloadclient", id);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_import_lists",
    "List import lists with their monitor mode, root folder, quality profile and sync settings. Credentials are redacted.",
    {},
    READ,
    async () => {
      try {
        return await listProviders(client, "/api/v3/importlist", "importLists");
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "test_import_lists",
    "Test import list connectivity. Without an id every list is tested.",
    { id: z.number().int().optional().describe("Import list id; omit to test all") },
    READ,
    async ({ id }) => {
      try {
        return await testProviders(client, "/api/v3/importlist", id);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "discover_movies",
    "List movies suggested by the import lists plus, optionally, Radarr's recommended, trending and popular feeds. Returns candidates with tmdbIds for add_movie.",
    {
      include_recommendations: z.boolean().optional().describe("Include recommendations"),
      include_trending: z.boolean().optional().describe("Include trending movies"),
      include_popular: z.boolean().optional().describe("Include popular movies"),
      limit: z.number().int().min(1).optional().describe("Return at most this many movies"),
    },
    READ,
    async ({ include_recommendations, include_trending, include_popular, limit }) => {
      try {
        const qs = buildQS({
          includeRecommendations: include_recommendations,
          includeTrending: include_trending,
          includePopular: include_popular,
        });
        const rows = (await client.fetch(`/api/v3/importlist/movie${qs}`)) as (Movie & {
          lists?: unknown[];
          isExcluded?: boolean;
          isExisting?: boolean;
        })[];
        const total = rows.length;
        const page = limit !== undefined ? rows.slice(0, limit) : rows;
        return ok({
          count: total,
          returned: page.length,
          movies: page.map((m) => ({
            ...summarizeLookup(m),
            isExisting: m.isExisting,
            isExcluded: m.isExcluded,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_notifications",
    "List notification connections and which events each one fires on. Credentials, webhook URLs and tokens are redacted.",
    {},
    READ,
    async () => {
      try {
        return await listProviders(client, "/api/v3/notification", "notifications", true);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_remote_path_mappings",
    "List remote path mappings (download client path -> Radarr path). Wrong mappings are the usual cause of 'file not found' import failures.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/remotepathmapping")) as unknown[];
        return ok({ count: rows.length, mappings: rows });
      } catch (e) {
        return err(e);
      }
    },
  );
}
