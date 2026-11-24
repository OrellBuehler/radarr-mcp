import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerCommandTools, COMMANDS } from "../tools/commands.js";
import { registerFileTools } from "../tools/files.js";
import { registerSettingsTools } from "../tools/settings.js";
import { registerProviderTools } from "../tools/providers.js";
import { registerLibraryTools } from "../tools/library.js";
import { registerSystemTools } from "../tools/system.js";
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
  const client = new RadarrClient("http://radarr:7878", "key");
  registerCommandTools(server as any, client);
  registerFileTools(server as any, client);
  registerSettingsTools(server as any, client);
  registerProviderTools(server as any, client);
  registerLibraryTools(server as any, client);
  registerSystemTools(server as any, client);
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

describe("command tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps restart, shutdown and log deletion out of the allowlist", () => {
    for (const name of ["Restart", "Shutdown", "DeleteLogFiles", "DeleteUpdateLogFiles"]) {
      expect(COMMANDS as readonly string[]).not.toContain(name);
    }
  });

  it("run_command posts the name with movieIds", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 7, name: "MoviesSearch", status: "queued" }));
    const res = await tools.get("run_command")!({ name: "MoviesSearch", movie_ids: [1, 2] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/command");
    expect(JSON.parse(init.body)).toEqual({ name: "MoviesSearch", movieIds: [1, 2] });
    expect(JSON.parse(res.content[0].text).id).toBe(7);
  });

  it("run_command adds the singular movieId for the commands that need it and merges params", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("run_command")!({
      name: "RenameFiles",
      movie_ids: [3],
      params: { files: [9] },
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      name: "RenameFiles",
      files: [9],
      movieIds: [3],
      movieId: 3,
    });
  });

  it("run_command never lets params override the allowlisted name", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("run_command")!({
      name: "RssSync",
      params: { name: "ResetApiKey", Name: "Restart", commandName: "Shutdown", files: [1] },
    });
    const raw = mockFetch.mock.calls[0][1].body as string;
    expect(JSON.parse(raw)).toEqual({ files: [1], name: "RssSync" });
    expect(raw).not.toMatch(/ResetApiKey|Restart|Shutdown/);
  });
});

describe("file tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_movie_files flattens quality, languages and media info", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 1,
          movieId: 2,
          relativePath: "Dune.mkv",
          quality: { quality: { name: "WEBDL-2160p" } },
          languages: [{ id: 1, name: "English" }],
          mediaInfo: { resolution: "3840x2160", videoCodec: "x265", audioChannels: 8 },
        },
      ]),
    );
    const res = await tools.get("list_movie_files")!({ movie_ids: [2] });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/moviefile?movieId=2");
    const file = JSON.parse(res.content[0].text).files[0];
    expect(file).toMatchObject({
      quality: "WEBDL-2160p",
      languages: ["English"],
      resolution: "3840x2160",
    });
    expect(file).not.toHaveProperty("mediaInfo");
  });

  it("delete_movie_files uses the bulk endpoint for several ids", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("delete_movie_files")!({ ids: [1, 2] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/moviefile/bulk");
    expect(JSON.parse(init.body)).toEqual({ movieFileIds: [1, 2] });
  });

  it("list_manual_import_candidates filters existing files by default", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 1,
          path: "/downloads/dune/file.mkv",
          movie: { id: 2, title: "Dune", year: 2021 },
          rejections: [{ reason: "Unknown movie" }],
        },
      ]),
    );
    const res = await tools.get("list_manual_import_candidates")!({ download_id: "abc" });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/manualimport?downloadId=abc&filterExistingFiles=true",
    );
    const file = JSON.parse(res.content[0].text).files[0];
    expect(file.movie).toBe("Dune (2021)");
    expect(file.rejections).toEqual(["Unknown movie"]);
  });
});

describe("settings tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_quality_profiles resolves the cutoff to its quality name", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 4,
          name: "HD",
          cutoff: 7,
          upgradeAllowed: true,
          items: [
            { allowed: true, quality: { id: 7, name: "Bluray-1080p" } },
            { allowed: false, quality: { id: 3, name: "WEBDL-480p" } },
          ],
        },
      ]),
    );
    const res = await tools.get("list_quality_profiles")!({});
    expect(JSON.parse(res.content[0].text).profiles[0]).toEqual({
      id: 4,
      name: "HD",
      upgradeAllowed: true,
      cutoff: "Bluray-1080p",
      allowedQualities: ["Bluray-1080p"],
    });
  });

  it("create_custom_format maps specifications to Radarr fields", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 60 }));
    await tools.get("create_custom_format")!({
      name: "x265",
      specifications: [
        { name: "HEVC", implementation: "ReleaseTitleSpecification", value: "x265" },
      ],
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/customformat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "x265",
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: "HEVC",
          implementation: "ReleaseTitleSpecification",
          negate: false,
          required: true,
          fields: [{ name: "value", value: "x265" }],
        },
      ],
    });
  });

  it("set_format_scores merges scores into the full profile", async () => {
    const profile = {
      id: 7,
      name: "HD",
      cutoff: 7,
      items: [],
      upgradeAllowed: true,
      minUpgradeFormatScore: 1,
      formatItems: [
        { format: 1, name: "Tier 01", score: 1800 },
        { format: 34, name: "x265", score: 500 },
      ],
    };
    mockFetch.mockResolvedValueOnce(mockJson(profile));
    mockFetch.mockImplementationOnce((_url, init) =>
      Promise.resolve(mockJson(JSON.parse(init.body))),
    );
    const res = await tools.get("set_format_scores")!({
      profile_id: 7,
      scores: [
        { format_id: 34, score: 3000 },
        { format_id: 60, score: 100 },
      ],
      min_upgrade_format_score: 10,
    });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("http://radarr:7878/api/v3/qualityprofile/7");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.formatItems).toEqual([
      { format: 1, name: "Tier 01", score: 1800 },
      { format: 34, name: "x265", score: 3000 },
      { format: 60, score: 100 },
    ]);
    expect(body.minUpgradeFormatScore).toBe(10);
    expect(body.upgradeAllowed).toBe(true);
    expect(JSON.parse(res.content[0].text).scores).toEqual([
      { format: 34, name: "x265", score: 3000 },
      { format: 60, score: 100 },
    ]);
  });

  it("list_tags switches to the detail endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("list_tags")!({ details: true });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/tag/detail");
  });

  it("get_config maps sections to their endpoints", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("get_config")!({ section: "mediamanagement" });
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/config/mediamanagement");
  });

  it("get_config redacts the API key and passwords of the host section", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({
        id: 1,
        port: 7878,
        authenticationMethod: "forms",
        username: "admin",
        password: "hunter2",
        passwordConfirmation: "hunter2",
        apiKey: "0123456789abcdef0123456789abcdef",
        sslCertPath: "/config/cert.pfx",
        sslCertPassword: "certpass",
        proxyHostname: "proxy.local",
        proxyUsername: "proxyuser",
        proxyPassword: "proxypass",
        applicationUrl: "https://user:pw@media.example.com/radarr",
        urlBase: "",
      }),
    );
    const res = await tools.get("get_config")!({ section: "host" });
    const text = res.content[0].text;
    for (const secret of [
      "hunter2",
      "0123456789abcdef0123456789abcdef",
      "certpass",
      "proxyuser",
      "proxypass",
      "user:pw",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.parse(text)).toEqual({
      id: 1,
      port: 7878,
      authenticationMethod: "forms",
      username: "<redacted>",
      password: "<redacted>",
      passwordConfirmation: "<redacted>",
      apiKey: "<redacted>",
      sslCertPath: "/config/cert.pfx",
      sslCertPassword: "<redacted>",
      proxyHostname: "proxy.local",
      proxyUsername: "<redacted>",
      proxyPassword: "<redacted>",
      applicationUrl: "https://<redacted>@media.example.com/radarr",
      urlBase: "",
    });
  });
});

describe("provider tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_indexers redacts secret fields and flattens the rest", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 1,
          name: "NZBgeek",
          implementation: "Newznab",
          protocol: "usenet",
          priority: 25,
          enableRss: true,
          fields: [
            { name: "baseUrl", value: "https://api.nzbgeek.info" },
            { name: "apiKey", value: "supersecret", privacy: "apiKey" },
            { name: "vipExpiration", value: "" },
          ],
        },
      ]),
    );
    const res = await tools.get("list_indexers")!({});
    const indexer = JSON.parse(res.content[0].text).indexers[0];
    expect(indexer.fields).toEqual({
      baseUrl: "https://api.nzbgeek.info",
      apiKey: "<redacted>",
    });
    expect(indexer).toMatchObject({ protocol: "usenet", priority: 25, enableRss: true });
  });

  it("list_indexers redacts passkeys, cookies and credentials embedded in URLs", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 2,
          name: "Tracker",
          implementation: "TorrentRssIndexer",
          fields: [
            { name: "baseUrl", value: "https://tracker.example/rss?passkey=abc123&cat=movies" },
            { name: "feedUrl", value: "https://bob:pw@tracker.example/feed?apikey=k1&token=t1" },
            {
              name: "rssUrl",
              value: "https://tracker.example/rss/0123456789abcdef0123456789abcdef/movies",
            },
            { name: "passkey", value: "abc123" },
            { name: "rssPasskey", value: "def456" },
            { name: "cookie", value: "uid=1; pass=xyz" },
            { name: "minimumSeeders", value: 1 },
          ],
        },
      ]),
    );
    const res = await tools.get("list_indexers")!({});
    const text = res.content[0].text;
    for (const secret of [
      "abc123",
      "def456",
      "bob",
      "pw@",
      "k1",
      "t1",
      "xyz",
      "0123456789abcdef",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.parse(text).indexers[0].fields).toEqual({
      baseUrl: "https://tracker.example/rss?passkey=<redacted>&cat=movies",
      feedUrl: "https://<redacted>@tracker.example/feed?apikey=<redacted>&token=<redacted>",
      rssUrl: "https://tracker.example/rss/<redacted>/movies",
      passkey: "<redacted>",
      rssPasskey: "<redacted>",
      cookie: "<redacted>",
      minimumSeeders: 1,
    });
  });

  it("list_notifications redacts webhook URLs down to their origin", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson([
        {
          id: 3,
          name: "Discord",
          implementation: "Discord",
          onGrab: true,
          fields: [
            { name: "webHookUrl", value: "https://discord.com/api/webhooks/1/abcDEF" },
            { name: "url", value: "https://hooks.example.com/services/T0/B0/xyz" },
            { name: "host", value: "https://plex.local:32400" },
            { name: "headers", value: [{ key: "Authorization", value: "Bearer s3cr3t" }] },
            { name: "username", value: "Radarr" },
          ],
        },
      ]),
    );
    const res = await tools.get("list_notifications")!({});
    const text = res.content[0].text;
    for (const secret of ["abcDEF", "services/T0", "s3cr3t"]) expect(text).not.toContain(secret);
    expect(JSON.parse(text).notifications[0].fields).toEqual({
      webHookUrl: "<redacted>",
      url: "https://hooks.example.com/<redacted>",
      host: "https://plex.local:32400",
      headers: "<redacted>",
      username: "<redacted>",
    });
  });

  it("test_indexers tests all without an id and posts the provider with one", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("test_indexers")!({});
    expect(mockFetch.mock.calls[0][0]).toBe("http://radarr:7878/api/v3/indexer/testall");

    mockFetch.mockResolvedValueOnce(mockJson({ id: 2, name: "x" }));
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("test_indexers")!({ id: 2 });
    expect(mockFetch.mock.calls[1][0]).toBe("http://radarr:7878/api/v3/indexer/2");
    const [url, init] = mockFetch.mock.calls[2];
    expect(url).toBe("http://radarr:7878/api/v3/indexer/test");
    expect(JSON.parse(init.body)).toEqual({ id: 2, name: "x" });
  });

  it("discover_movies passes the feed toggles through", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([{ title: "Dune", tmdbId: 1, isExisting: false }]));
    await tools.get("discover_movies")!({ include_trending: true, limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://radarr:7878/api/v3/importlist/movie?includeTrending=true",
    );
  });
});

describe("library tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_collections omits the movie list unless asked", async () => {
    const collection = {
      id: 1,
      title: "Dune Collection",
      tmdbId: 726871,
      monitored: true,
      missingMovies: 1,
      movies: [{ tmdbId: 438631, title: "Dune", year: 2021, isExisting: true }],
    };
    mockFetch.mockResolvedValueOnce(mockJson([collection]));
    let payload = JSON.parse((await tools.get("list_collections")!({})).content[0].text);
    expect(payload.collections[0].movieCount).toBe(1);
    expect(payload.collections[0]).not.toHaveProperty("movies");

    mockFetch.mockResolvedValueOnce(mockJson([collection]));
    payload = JSON.parse(
      (await tools.get("list_collections")!({ include_movies: true })).content[0].text,
    );
    expect(payload.collections[0].movies[0].title).toBe("Dune");
  });

  it("update_collections sends only the given fields", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("update_collections")!({ collection_ids: [1], monitored: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://radarr:7878/api/v3/collection");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ collectionIds: [1], monitored: true });
  });

  it("add_exclusion posts the tmdb identity", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({}));
    await tools.get("add_exclusion")!({ tmdb_id: 1, movie_title: "Dune", movie_year: 2021 });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      tmdbId: 1,
      movieTitle: "Dune",
      movieYear: 2021,
    });
  });
});

describe("system tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("get_health counts the issues", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([{ source: "IndexerCheck", type: "warning" }]));
    const res = await tools.get("get_health")!({});
    expect(JSON.parse(res.content[0].text).count).toBe(1);
  });

  it("get_logs defaults to newest first and trims the records", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        records: [{ id: 1, time: "t", level: "error", logger: "l", message: "m", method: "x" }],
      }),
    );
    const res = await tools.get("get_logs")!({ level: "error" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("level=error");
    expect(url).toContain("sortDirection=descending");
    const record = JSON.parse(res.content[0].text).records[0];
    expect(record.message).toBe("m");
    expect(record).not.toHaveProperty("method");
  });
});
