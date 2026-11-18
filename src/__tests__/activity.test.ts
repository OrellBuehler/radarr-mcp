import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerActivityTools } from "../tools/activity.js";
import { RadarrClient } from "../radarr/client.js";

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (
      name: string,
      _desc: string,
      _schema: unknown,
      _annotations: unknown,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
    },
  };
  registerActivityTools(server as any, new RadarrClient("http://radarr:7878", "key"));
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

describe("activity tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("get_calendar keeps the release dates alongside the movie summary", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 1,
          title: "Dune",
          year: 2021,
          inCinemas: "2021-09-15T00:00:00Z",
          digitalRelease: "2021-10-22T00:00:00Z",
        },
      ]),
    );
    const res = await tools.get("get_calendar")!({ start: "2026-01-01", end: "2026-02-01" });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/calendar?start=2026-01-01&end=2026-02-01",
    );
    const payload = JSON.parse(res.content[0].text);
    expect(payload.movies[0].digitalRelease).toBe("2021-10-22T00:00:00Z");
  });

  it("get_history defaults to newest first and lifts useful data fields", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        records: [
          {
            id: 3,
            movieId: 1,
            eventType: "grabbed",
            sourceTitle: "release.title",
            quality: { quality: { name: "Bluray-1080p" } },
            data: { indexer: "nzbgeek", downloadClient: "sab", nzbInfoUrl: "http://x" },
          },
        ],
      }),
    );
    const res = await tools.get("get_history")!({});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("sortKey=date");
    expect(url).toContain("sortDirection=descending");
    const record = JSON.parse(res.content[0].text).records[0];
    expect(record).toMatchObject({
      indexer: "nzbgeek",
      downloadClient: "sab",
      quality: "Bluray-1080p",
    });
    expect(record).not.toHaveProperty("nzbInfoUrl");
  });

  it("get_movie_history filters by event type", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("get_movie_history")!({ movie_id: 4, event_type: "downloadFailed" });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/history/movie?movieId=4&eventType=downloadFailed",
    );
  });

  it("mark_history_failed posts to the failed endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("mark_history_failed")!({ id: 12 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/history/failed/12");
    expect(init.method).toBe("POST");
  });

  it("get_wanted routes to the requested list", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ page: 1, records: [] }));
    await tools.get("get_wanted")!({ kind: "cutoff", page_size: 5 });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/wanted/cutoff?pageSize=5");
  });

  it("remove_blocklist_items uses bulk only for several ids", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("remove_blocklist_items")!({ ids: [1] });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/blocklist/1");

    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("remove_blocklist_items")!({ ids: [1, 2] });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("http://radarr:7878/api/v3/blocklist/bulk");
    expect(JSON.parse(init.body)).toEqual({ ids: [1, 2] });
  });
});
