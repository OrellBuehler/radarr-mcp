import { describe, it, expect } from "vitest";
import { createServer } from "../server.js";
import { RadarrClient } from "../radarr/client.js";

describe("createServer", () => {
  it("registers every tool group under unique snake_case names", () => {
    const names: string[] = [];
    const server = createServer(new RadarrClient("http://radarr:7878", "key")) as any;
    for (const name of Object.keys(server._registeredTools ?? {})) names.push(name);
    expect(names.length).toBeGreaterThan(30);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const expected of ["list_movies", "add_movie", "get_queue", "run_command", "get_health"]) {
      expect(names).toContain(expected);
    }
  });

  it("annotates every tool with read-only and destructive hints", () => {
    const server = createServer(new RadarrClient("http://radarr:7878", "key")) as any;
    const tools = Object.entries(server._registeredTools) as [string, any][];
    expect(tools.length).toBeGreaterThan(30);
    for (const [name, tool] of tools) {
      expect(typeof tool.annotations?.readOnlyHint, name).toBe("boolean");
      if (!tool.annotations.readOnlyHint) {
        expect(typeof tool.annotations.destructiveHint, name).toBe("boolean");
        expect(typeof tool.annotations.idempotentHint, name).toBe("boolean");
      }
      expect(tool.annotations.readOnlyHint, name).toBe(
        /^(get|list|search|lookup|parse|test|discover)_/.test(name),
      );
    }
    for (const name of [
      "delete_movie",
      "delete_movies",
      "delete_movie_files",
      "remove_queue_items",
      "remove_blocklist_items",
      "remove_exclusions",
      "delete_tag",
      "mark_history_failed",
      "run_command",
    ]) {
      expect(server._registeredTools[name].annotations.destructiveHint, name).toBe(true);
    }
  });
});
