import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, redactSecrets } from "../radarr/format.js";
import type { RadarrClient } from "../radarr/client.js";
import { DESTRUCTIVE, READ, UPDATE, WRITE } from "./annotations.js";

export const CONFIG_SECTIONS = {
  naming: "/api/v3/config/naming",
  mediamanagement: "/api/v3/config/mediamanagement",
  ui: "/api/v3/config/ui",
  host: "/api/v3/config/host",
  downloadclient: "/api/v3/config/downloadclient",
  indexer: "/api/v3/config/indexer",
  importlist: "/api/v3/config/importlist",
  metadata: "/api/v3/config/metadata",
} as const;

interface QualityProfile {
  id?: number;
  name?: string;
  cutoff?: number;
  upgradeAllowed?: boolean;
  minFormatScore?: number;
  cutoffFormatScore?: number;
  items?: { allowed?: boolean; quality?: { id?: number; name?: string }; name?: string }[];
}

function summarizeProfile(p: QualityProfile): Record<string, unknown> {
  const qualities: string[] = [];
  for (const item of p.items ?? []) {
    if (!item.allowed) continue;
    qualities.push(item.quality?.name ?? item.name ?? "");
  }
  const cutoff = (p.items ?? []).find((i) => i.quality?.id === p.cutoff);
  return {
    id: p.id,
    name: p.name,
    upgradeAllowed: p.upgradeAllowed,
    cutoff: cutoff?.quality?.name ?? p.cutoff,
    minFormatScore: p.minFormatScore,
    cutoffFormatScore: p.cutoffFormatScore,
    allowedQualities: qualities.filter(Boolean),
  };
}

export function registerSettingsTools(server: McpServer, client: RadarrClient) {
  server.tool(
    "list_quality_profiles",
    "List quality profiles with their cutoff and allowed qualities. add_movie and update_movie need one of these ids.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/qualityprofile")) as QualityProfile[];
        return ok({ count: rows.length, profiles: rows.map(summarizeProfile) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_quality_profile",
    "Get one quality profile in full, including every quality item and custom format score.",
    { id: z.number().int().describe("Quality profile id") },
    READ,
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/v3/qualityprofile/${id}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_root_folders",
    "List root folders with free space and whether Radarr can reach them. add_movie needs one of these paths.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/rootfolder")) as {
          id?: number;
          path?: string;
          accessible?: boolean;
          freeSpace?: number;
          unmappedFolders?: unknown[];
        }[];
        return ok({
          count: rows.length,
          rootFolders: rows.map((r) => ({
            id: r.id,
            path: r.path,
            accessible: r.accessible,
            freeSpace: r.freeSpace,
            unmappedFolders: (r.unmappedFolders ?? []).length,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_tags",
    "List tags. With details, each tag also carries the ids of the movies, indexers, import lists, notifications and profiles using it.",
    {
      details: z
        .boolean()
        .optional()
        .describe("Include what each tag is attached to (default false)"),
    },
    READ,
    async ({ details }) => {
      try {
        const rows = (await client.fetch(
          details ? "/api/v3/tag/detail" : "/api/v3/tag",
        )) as unknown[];
        return ok({ count: rows.length, tags: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_tag",
    "Create a tag. Tags drive delay profiles, release profiles, import list and notification targeting.",
    { label: z.string().describe("Tag label, e.g. '4k' or 'kids'") },
    WRITE,
    async ({ label }) => {
      try {
        return ok(await client.json("/api/v3/tag", "POST", { label }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "update_tag",
    "Rename an existing tag. Everything tagged with it keeps the association.",
    { id: z.number().int().describe("Tag id"), label: z.string().describe("New label") },
    UPDATE,
    async ({ id, label }) => {
      try {
        return ok(await client.json(`/api/v3/tag/${id}`, "PUT", { id, label }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "delete_tag",
    "Delete a tag and remove it from everything using it. Check list_tags with details first.",
    { id: z.number().int().describe("Tag id") },
    DESTRUCTIVE,
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/v3/tag/${id}`, { method: "DELETE" }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_custom_formats",
    "List custom formats with their specifications. Their scores per quality profile decide which releases Radarr prefers.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/customformat")) as unknown[];
        return ok({ count: rows.length, customFormats: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_custom_format",
    "Create a custom format from one or more specifications. Radarr adds it to every quality profile with score 0; set its score per profile with set_format_scores.",
    {
      name: z.string().describe("Custom format name"),
      include_when_renaming: z
        .boolean()
        .optional()
        .describe("Expose the format to the {Custom Formats} naming token (default false)"),
      specifications: z
        .array(
          z.object({
            name: z.string().describe("Specification name"),
            implementation: z
              .string()
              .describe(
                "Specification type, e.g. 'ReleaseTitleSpecification' (regex), 'ResolutionSpecification', 'SourceSpecification'",
              ),
            value: z
              .union([z.string(), z.number()])
              .describe("The specification's value: a regex, or the resolution/source enum value"),
            negate: z.boolean().optional().describe("Match when the condition is false"),
            required: z
              .boolean()
              .optional()
              .describe("Must match (default true); non-required specs of one type are OR-ed"),
          }),
        )
        .min(1)
        .describe("Conditions the release must meet"),
    },
    WRITE,
    async ({ name, include_when_renaming, specifications }) => {
      try {
        return ok(
          await client.json("/api/v3/customformat", "POST", {
            name,
            includeCustomFormatWhenRenaming: include_when_renaming ?? false,
            specifications: specifications.map((s) => ({
              name: s.name,
              implementation: s.implementation,
              negate: s.negate ?? false,
              required: s.required ?? true,
              fields: [{ name: "value", value: s.value }],
            })),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "set_format_scores",
    "Set custom format scores on one quality profile, optionally with its upgrade settings. Scores not listed stay as they are. Raising a score can make Radarr upgrade existing files.",
    {
      profile_id: z.number().int().describe("Quality profile id"),
      scores: z
        .array(
          z.object({
            format_id: z.number().int().describe("Custom format id"),
            score: z.number().int().describe("Score for releases matching the format"),
          }),
        )
        .describe("Format scores to set"),
      upgrade_allowed: z.boolean().optional().describe("Allow upgrading existing files"),
      min_format_score: z
        .number()
        .int()
        .optional()
        .describe("Minimum custom format score a release needs"),
      cutoff_format_score: z
        .number()
        .int()
        .optional()
        .describe("Stop upgrading once a file reaches this score"),
      min_upgrade_format_score: z
        .number()
        .int()
        .optional()
        .describe("Minimum score gain for an upgrade"),
    },
    UPDATE,
    async ({
      profile_id,
      scores,
      upgrade_allowed,
      min_format_score,
      cutoff_format_score,
      min_upgrade_format_score,
    }) => {
      try {
        const profile = (await client.fetch(`/api/v3/qualityprofile/${profile_id}`)) as Record<
          string,
          unknown
        > & { formatItems?: { format: number; name?: string; score: number }[] };
        const items = [...(profile.formatItems ?? [])];
        for (const { format_id, score } of scores) {
          const existing = items.find((i) => i.format === format_id);
          if (existing) existing.score = score;
          else items.push({ format: format_id, score });
        }
        const body: Record<string, unknown> = { ...profile, formatItems: items };
        if (upgrade_allowed !== undefined) body.upgradeAllowed = upgrade_allowed;
        if (min_format_score !== undefined) body.minFormatScore = min_format_score;
        if (cutoff_format_score !== undefined) body.cutoffFormatScore = cutoff_format_score;
        if (min_upgrade_format_score !== undefined)
          body.minUpgradeFormatScore = min_upgrade_format_score;
        const updated = (await client.json(
          `/api/v3/qualityprofile/${profile_id}`,
          "PUT",
          body,
        )) as QualityProfile & { minUpgradeFormatScore?: number; formatItems?: typeof items };
        const ids = new Set(scores.map((s) => s.format_id));
        return ok({
          ...summarizeProfile(updated),
          minUpgradeFormatScore: updated.minUpgradeFormatScore,
          scores: (updated.formatItems ?? []).filter((i) => ids.has(i.format)),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_quality_definitions",
    "List quality definitions with their size limits in MB/minute. These are what reject a release as too small or too large.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/qualitydefinition")) as {
          id?: number;
          title?: string;
          weight?: number;
          minSize?: number;
          maxSize?: number;
          preferredSize?: number;
          quality?: { id?: number; name?: string; source?: string; resolution?: number };
        }[];
        return ok({
          count: rows.length,
          definitions: rows.map((d) => ({
            id: d.id,
            quality: d.quality?.name,
            title: d.title,
            resolution: d.quality?.resolution,
            source: d.quality?.source,
            minSize: d.minSize,
            maxSize: d.maxSize,
            preferredSize: d.preferredSize,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_languages",
    "List the languages Radarr knows, with the ids used in profiles and release filters.",
    {},
    READ,
    async () => {
      try {
        const rows = (await client.fetch("/api/v3/language")) as unknown[];
        return ok({ count: rows.length, languages: rows });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_config",
    `Read a Radarr settings section. Sections: ${Object.keys(CONFIG_SECTIONS).join(", ")}. 'naming' is the file/folder naming format, 'mediamanagement' covers import behaviour, permissions and root folder handling. API keys, usernames and passwords (the 'host' section carries Radarr's own) are redacted.`,
    {
      section: z
        .enum(Object.keys(CONFIG_SECTIONS) as [string, ...string[]])
        .describe("Settings section to read"),
    },
    READ,
    async ({ section }) => {
      try {
        const config = await client.fetch(CONFIG_SECTIONS[section as keyof typeof CONFIG_SECTIONS]);
        return ok(redactSecrets(config as Record<string, unknown>));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_naming_examples",
    "Render example file and folder names for the current naming configuration. Use it to sanity-check a naming format before adopting it.",
    {},
    READ,
    async () => {
      try {
        return ok(await client.fetch("/api/v3/config/naming/examples"));
      } catch (e) {
        return err(e);
      }
    },
  );
}
