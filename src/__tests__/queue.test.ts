import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerQueueTools } from "../tools/queue.js";
import { registerReleaseTools } from "../tools/releases.js";
import { RadarrClient } from "../radarr/client.js";

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  };
  const client = new RadarrClient("http://radarr:7878", "key");
  registerQueueTools(server as any, client);
  registerReleaseTools(server as any, client);
  return tools;
}

const tools = collectTools();

function mockJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("queue tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("get_queue asks for movie details and summarizes the records", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        records: [
          {
            id: 5,
            movieId: 1,
            title: "release.title",
            status: "downloading",
            movie: { title: "Dune", year: 2021, overview: "long text" },
            quality: { quality: { name: "WEBDL-2160p" } },
          },
        ],
      }),
    );
    const res = await tools.get("get_queue")!({ movie_ids: [1, 2], status: ["downloading"] });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("movieIds=1&movieIds=2");
    expect(url).toContain("status=downloading");
    expect(url).toContain("includeMovie=true");
    const payload = JSON.parse(res.content[0].text);
    expect(payload.totalRecords).toBe(1);
    expect(payload.records[0].movie).toBe("Dune (2021)");
    expect(payload.records[0].quality).toBe("WEBDL-2160p");
  });

  it("remove_queue_items deletes a single id directly", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("remove_queue_items")!({ ids: [5], blocklist: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "http://radarr:7878/api/v3/queue/5?removeFromClient=true&blocklist=true&skipRedownload=false",
    );
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("remove_queue_items uses the bulk endpoint for several ids", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("remove_queue_items")!({ ids: [5, 6] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v3/queue/bulk?");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ ids: [5, 6] });
  });

  it("grab_queue_items posts to the bulk grab endpoint for several ids", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("grab_queue_items")!({ ids: [1, 2] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/queue/grab/bulk");
    expect(JSON.parse(init.body)).toEqual({ ids: [1, 2] });
  });
});

describe("release tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("search_releases can drop rejected releases", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        { guid: "a", rejected: true, rejections: ["too small"], protocol: "usenet" },
        { guid: "b", rejected: false, protocol: "torrent", seeders: 10 },
      ]),
    );
    const res = await tools.get("search_releases")!({ movie_id: 3, include_rejected: false });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/release?movieId=3");
    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.releases[0]).toMatchObject({ guid: "b", seeders: 10 });
  });

  it("grab_release posts guid and indexer id, and overrides only when a movie is given", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("grab_release")!({ guid: "g", indexer_id: 2 });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ guid: "g", indexerId: 2 });

    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("grab_release")!({ guid: "g", indexer_id: 2, movie_id: 4 });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
      guid: "g",
      indexerId: 2,
      movieId: 4,
      shouldOverride: true,
    });
  });

  it("parse_release_title encodes the title", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("parse_release_title")!({ title: "Dune 2021 2160p" });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/parse?title=Dune+2021+2160p",
    );
  });
});
