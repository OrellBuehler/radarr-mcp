import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config", () => {
  it("normalizes the base URL and keeps a reverse-proxy path", async () => {
    vi.stubEnv("RADARR_URL", "radarr.local:7878/radarr/");
    vi.stubEnv("RADARR_API_KEY", "k");
    const { config, normalizeBaseUrl } = await import("../config.js");
    expect(config.baseUrl).toBe("http://radarr.local:7878/radarr");
    expect(normalizeBaseUrl("https://radarr.example.com/api/v3")).toBe(
      "https://radarr.example.com",
    );
  });

  it("accepts RADARR_SERVER as an alias", async () => {
    vi.stubEnv("RADARR_URL", "");
    vi.stubEnv("RADARR_SERVER", "http://box:7878");
    vi.stubEnv("RADARR_API_KEY", "k");
    const { config } = await import("../config.js");
    expect(config.baseUrl).toBe("http://box:7878");
  });

  it("exits when the API key is missing", async () => {
    vi.stubEnv("RADARR_URL", "http://box:7878");
    vi.stubEnv("RADARR_API_KEY", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(import("../config.js")).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
