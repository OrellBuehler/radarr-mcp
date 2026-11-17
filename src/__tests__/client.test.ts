import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RadarrClient } from "../radarr/client.js";

function mockJson(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("RadarrClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the API key as a header and strips trailing slashes from the base URL", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ version: "5.0" }));
    const client = new RadarrClient("http://radarr.local:7878/", "secret");
    await client.fetch("/api/v3/system/status");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr.local:7878/api/v3/system/status");
    expect(init.headers["X-Api-Key"]).toBe("secret");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("sets a JSON content type for bodies", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1 }));
    const client = new RadarrClient("http://radarr.local:7878", "secret");
    await client.json("/api/v3/tag", "POST", { label: "4k" });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"label":"4k"}');
  });

  it("throws with status and body on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: new Headers(),
      text: () => Promise.resolve("Invalid API Key"),
    });
    const client = new RadarrClient("http://radarr.local:7878", "bad");
    await expect(client.fetch("/api/v3/movie")).rejects.toThrow(
      "401 Unauthorized: Invalid API Key",
    );
  });

  it("reports timeouts with the configured budget", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const client = new RadarrClient("http://radarr.local:7878", "secret", 1234);
    await expect(client.fetch("/api/v3/movie")).rejects.toThrow(
      "Radarr request timed out after 1234ms",
    );
  });

  it("refuses to follow redirects so the API key stays on the configured host", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    const client = new RadarrClient("http://radarr.local:7878", "secret");
    await client.fetch("/api/v3/movie", { redirect: "follow" });
    expect(mockFetch.mock.calls[0][1].redirect).toBe("error");

    mockFetch.mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: new Error("unexpected redirect") }),
    );
    await expect(client.fetch("/api/v3/movie")).rejects.toThrow(/redirect, which is not followed/);
  });

  it("returns a success marker for empty bodies", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      text: () => Promise.resolve(""),
    });
    const client = new RadarrClient("http://radarr.local:7878", "secret");
    expect(await client.fetch("/api/v3/movie/1", { method: "DELETE" })).toEqual({ success: true });
  });
});
