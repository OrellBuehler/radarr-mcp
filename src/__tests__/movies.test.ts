import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerMovieTools } from "../tools/movies.js";
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
  registerMovieTools(server as any, new RadarrClient("http://radarr:7878", "key"));
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

const MOVIES = [
  {
    id: 1,
    title: "Arrival",
    originalTitle: "Arrival",
    year: 2016,
    tmdbId: 329865,
    monitored: true,
    hasFile: true,
    status: "released",
    qualityProfileId: 4,
    tags: [2],
  },
  {
    id: 2,
    title: "Dune",
    year: 2021,
    tmdbId: 438631,
    monitored: false,
    hasFile: false,
    status: "released",
    qualityProfileId: 5,
    tags: [],
  },
];

describe("movie tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_movies summarizes and filters client-side", async () => {
    mockFetch.mockResolvedValueOnce(mockJson(MOVIES));
    const res = await tools.get("list_movies")!({ monitored: true });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/movie?excludeLocalCovers=true",
    );
    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.movies[0]).toMatchObject({ id: 1, title: "Arrival", tmdbId: 329865 });
    expect(payload.movies[0]).not.toHaveProperty("originalTitle");
  });

  it("list_movies matches the search term against title and original title, and applies limit", async () => {
    mockFetch.mockResolvedValueOnce(mockJson(MOVIES));
    const res = await tools.get("list_movies")!({ search: "DUN", limit: 5 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.movies[0].title).toBe("Dune");
  });

  it("list_movies filters by tag id", async () => {
    mockFetch.mockResolvedValueOnce(mockJson(MOVIES));
    const payload = JSON.parse((await tools.get("list_movies")!({ tag_id: 2 })).content[0].text);
    expect(payload.movies.map((m: any) => m.id)).toEqual([1]);
  });

  it("lookup_movie by tmdb id hits the tmdb lookup endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson(MOVIES[1]));
    const res = await tools.get("lookup_movie")!({ tmdb_id: 438631 });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/movie/lookup/tmdb?tmdbId=438631",
    );
    expect(JSON.parse(res.content[0].text).results[0].tmdbId).toBe(438631);
  });

  it("lookup_movie requires one of term, imdb_id or tmdb_id", async () => {
    const res = await tools.get("lookup_movie")!({});
    expect(res.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("add_movie looks the movie up and posts it with the add options", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ title: "Dune", tmdbId: 438631, year: 2021 }));
    mockFetch.mockResolvedValueOnce(mockJson({ id: 9, title: "Dune", tmdbId: 438631 }));
    await tools.get("add_movie")!({
      tmdb_id: 438631,
      root_folder_path: "/movies",
      quality_profile_id: 4,
      tags: [1],
    });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("http://radarr:7878/api/v3/movie");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "Dune",
      tmdbId: 438631,
      year: 2021,
      rootFolderPath: "/movies",
      qualityProfileId: 4,
      monitored: true,
      minimumAvailability: "released",
      tags: [1],
      addOptions: { monitor: "movieOnly", searchForMovie: true },
    });
  });

  it("update_movie merges into the current record and passes moveFiles", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({ id: 1, title: "Arrival", monitored: false, tags: [] }),
    );
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1, title: "Arrival", monitored: true }));
    await tools.get("update_movie")!({ id: 1, monitored: true, move_files: true });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("http://radarr:7878/api/v3/movie/1?moveFiles=true");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ id: 1, title: "Arrival", monitored: true, tags: [] });
  });

  it("delete_movie defaults both destructive flags to false", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("delete_movie")!({ id: 3 });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/movie/3?deleteFiles=false&addImportExclusion=false",
    );
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("edit_movies only sends the given fields and defaults applyTags to add", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("edit_movies")!({ movie_ids: [1, 2], tags: [7] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/movie/editor");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ movieIds: [1, 2], tags: [7], applyTags: "add" });
  });

  it("delete_movies posts the bulk editor payload", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("delete_movies")!({ movie_ids: [1, 2], delete_files: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/movie/editor");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({
      movieIds: [1, 2],
      deleteFiles: true,
      addImportExclusion: false,
    });
  });

  it("surfaces API errors through err()", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      text: () => Promise.resolve("NotFound"),
    });
    const res = await tools.get("get_movie")!({ id: 99 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("404");
  });
});
