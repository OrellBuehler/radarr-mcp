export function buildQS(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null) continue;
        sp.append(k, String(item));
      }
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function ok(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text" as const, text }] };
}

export function err(e: unknown) {
  return { content: [{ type: "text" as const, text: String(e) }], isError: true as const };
}

export interface Movie {
  id?: number;
  title?: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  status?: string;
  monitored?: boolean;
  hasFile?: boolean;
  isAvailable?: boolean;
  sizeOnDisk?: number;
  path?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  minimumAvailability?: string;
  tags?: number[];
  added?: string;
  runtime?: number;
  studio?: string;
  genres?: string[];
  overview?: string;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  folderName?: string;
  movieFile?: { quality?: { quality?: { name?: string } }; size?: number };
}

export function summarizeMovie(m: Movie): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    title: m.title,
    year: m.year,
    tmdbId: m.tmdbId,
    monitored: m.monitored,
    hasFile: m.hasFile,
    status: m.status,
  };
  if (m.isAvailable !== undefined) out.isAvailable = m.isAvailable;
  if (m.qualityProfileId !== undefined) out.qualityProfileId = m.qualityProfileId;
  if (m.sizeOnDisk) out.sizeOnDisk = m.sizeOnDisk;
  if (m.movieFile?.quality?.quality?.name) out.quality = m.movieFile.quality.quality.name;
  if (m.path) out.path = m.path;
  if (m.tags?.length) out.tags = m.tags;
  return out;
}

export function summarizeLookup(m: Movie): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: m.title,
    year: m.year,
    tmdbId: m.tmdbId,
    status: m.status,
  };
  if (m.id) out.id = m.id;
  if (m.imdbId) out.imdbId = m.imdbId;
  if (m.runtime) out.runtime = m.runtime;
  if (m.studio) out.studio = m.studio;
  if (m.genres?.length) out.genres = m.genres;
  if (m.overview) out.overview = m.overview.slice(0, 300);
  return out;
}

export interface QueueItem {
  id?: number;
  movieId?: number;
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  errorMessage?: string;
  statusMessages?: { title?: string; messages?: string[] }[];
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  protocol?: string;
  downloadClient?: string;
  indexer?: string;
  downloadId?: string;
  outputPath?: string;
  quality?: { quality?: { name?: string } };
  movie?: Movie;
}

export function summarizeQueueItem(q: QueueItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: q.id,
    movieId: q.movieId,
    title: q.title,
    status: q.status,
    trackedDownloadStatus: q.trackedDownloadStatus,
    trackedDownloadState: q.trackedDownloadState,
    protocol: q.protocol,
    downloadClient: q.downloadClient,
    indexer: q.indexer,
    size: q.size,
    sizeleft: q.sizeleft,
    timeleft: q.timeleft,
  };
  if (q.quality?.quality?.name) out.quality = q.quality.quality.name;
  if (q.movie?.title) out.movie = `${q.movie.title} (${q.movie.year})`;
  if (q.errorMessage) out.errorMessage = q.errorMessage;
  const messages = (q.statusMessages ?? []).flatMap((m) => m.messages ?? []);
  if (messages.length) out.statusMessages = messages;
  return out;
}

export interface Release {
  guid?: string;
  title?: string;
  indexerId?: number;
  indexer?: string;
  size?: number;
  age?: number;
  seeders?: number;
  leechers?: number;
  protocol?: string;
  quality?: { quality?: { name?: string } };
  customFormatScore?: number;
  languages?: { name?: string }[];
  approved?: boolean;
  rejected?: boolean;
  rejections?: string[];
  downloadAllowed?: boolean;
  releaseWeight?: number;
  publishDate?: string;
  movieId?: number;
}

export function summarizeRelease(r: Release): Record<string, unknown> {
  const out: Record<string, unknown> = {
    guid: r.guid,
    title: r.title,
    indexerId: r.indexerId,
    indexer: r.indexer,
    protocol: r.protocol,
    size: r.size,
    age: r.age,
    quality: r.quality?.quality?.name,
    customFormatScore: r.customFormatScore,
    rejected: r.rejected,
    downloadAllowed: r.downloadAllowed,
    publishDate: r.publishDate,
  };
  if (r.protocol === "torrent") {
    out.seeders = r.seeders;
    out.leechers = r.leechers;
  }
  if (r.languages?.length) out.languages = r.languages.map((l) => l.name);
  if (r.rejections?.length) out.rejections = r.rejections;
  return out;
}

export interface Paged<T> {
  page?: number;
  pageSize?: number;
  totalRecords?: number;
  sortKey?: string;
  sortDirection?: string;
  records?: T[];
}

export function summarizePaged<T, R>(
  res: Paged<T>,
  map: (record: T) => R,
): Record<string, unknown> {
  return {
    page: res.page,
    pageSize: res.pageSize,
    totalRecords: res.totalRecords,
    records: (res.records ?? []).map(map),
  };
}
