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
});
