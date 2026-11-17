import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RadarrClient } from "./radarr/client.js";
import { registerMovieTools } from "./tools/movies.js";
import { registerFileTools } from "./tools/files.js";
import { registerQueueTools } from "./tools/queue.js";
import { registerReleaseTools } from "./tools/releases.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerCommandTools } from "./tools/commands.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerProviderTools } from "./tools/providers.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerSystemTools } from "./tools/system.js";

export function createServer(client: RadarrClient): McpServer {
  const server = new McpServer({ name: "radarr-mcp", version: "0.2.0" });
  registerMovieTools(server, client);
  registerFileTools(server, client);
  registerQueueTools(server, client);
  registerReleaseTools(server, client);
  registerActivityTools(server, client);
  registerCommandTools(server, client);
  registerSettingsTools(server, client);
  registerProviderTools(server, client);
  registerLibraryTools(server, client);
  registerSystemTools(server, client);
  return server;
}
