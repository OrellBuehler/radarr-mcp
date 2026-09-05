import { describe, it, expect } from "vitest";
import {
  buildQS,
  ok,
  err,
  summarizeMovie,
  summarizeLookup,
  summarizeQueueItem,
  summarizeRelease,
  summarizePaged,
} from "../radarr/format.js";

describe("buildQS", () => {
  it("returns an empty string when nothing is set", () => {
    expect(buildQS({ a: undefined, b: null })).toBe("");
  });

  it("repeats array values instead of comma-joining them", () => {
    expect(buildQS({ movieIds: [1, 2, 3] })).toBe("?movieIds=1&movieIds=2&movieIds=3");
  });

  it("skips empty arrays and keeps false values", () => {
    expect(buildQS({ ids: [], deleteFiles: false })).toBe("?deleteFiles=false");
  });
});

describe("ok/err", () => {
  it("passes strings through unquoted and stringifies objects", () => {
    expect(ok("hello").content[0].text).toBe("hello");
    expect(ok({ a: 1 }).content[0].text).toBe('{"a":1}');
  });

  it("marks errors", () => {
    const res = err(new Error("boom"));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
  });
});

describe("summarizers", () => {
  it("summarizeMovie keeps the identifying fields and the file quality", () => {
    expect(
      summarizeMovie({
        id: 7,
        title: "Arrival",
        year: 2016,
        tmdbId: 329865,
        monitored: true,
        hasFile: true,
        status: "released",
        sizeOnDisk: 123,
        path: "/movies/Arrival",
        tags: [3],
        overview: "x".repeat(500),
        movieFile: { quality: { quality: { name: "Bluray-1080p" } } },
      }),
    ).toEqual({
      id: 7,
      title: "Arrival",
      year: 2016,
      tmdbId: 329865,
      monitored: true,
      hasFile: true,
      status: "released",
      sizeOnDisk: 123,
      quality: "Bluray-1080p",
      path: "/movies/Arrival",
      tags: [3],
    });
  });

  it("summarizeLookup truncates the overview", () => {
    const out = summarizeLookup({ title: "A", year: 2020, tmdbId: 1, overview: "x".repeat(500) });
    expect(String(out.overview)).toHaveLength(300);
  });

  it("summarizeQueueItem flattens status messages", () => {
    const out = summarizeQueueItem({
      id: 1,
      movieId: 2,
      title: "release.title",
      status: "completed",
      trackedDownloadStatus: "warning",
      statusMessages: [{ title: "t", messages: ["no files found"] }],
      movie: { title: "Arrival", year: 2016 },
    });
    expect(out.statusMessages).toEqual(["no files found"]);
    expect(out.movie).toBe("Arrival (2016)");
  });

  it("summarizeRelease only reports peers for torrents", () => {
    const usenet = summarizeRelease({ guid: "g", protocol: "usenet", seeders: 5 });
    expect(usenet).not.toHaveProperty("seeders");
    const torrent = summarizeRelease({ guid: "g", protocol: "torrent", seeders: 5, leechers: 1 });
    expect(torrent.seeders).toBe(5);
  });

  it("summarizePaged keeps the paging envelope", () => {
    expect(
      summarizePaged({ page: 2, pageSize: 10, totalRecords: 40, records: [1, 2] }, (n) => n * 2),
    ).toEqual({ page: 2, pageSize: 10, totalRecords: 40, records: [2, 4] });
  });
});
