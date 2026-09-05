import { RadarrClient } from "./radarr/client.js";

const rawUrl = (process.env.RADARR_URL || process.env.RADARR_SERVER || "").trim();
const apiKey = (process.env.RADARR_API_KEY || "").trim();

if (!rawUrl || !apiKey) {
  console.error(
    "RADARR_URL (or RADARR_SERVER) and RADARR_API_KEY environment variables are required. " +
      "The API key is in Radarr under Settings -> General -> Security.",
  );
  process.exit(1);
}

export function normalizeBaseUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  return withScheme.replace(/\/+$/, "").replace(/\/api(\/v3)?$/i, "");
}

const baseUrl = normalizeBaseUrl(rawUrl);

export const config = {
  baseUrl,
  apiKey,
  transport: "stdio" as const,
};

export const client = new RadarrClient(baseUrl, apiKey);
