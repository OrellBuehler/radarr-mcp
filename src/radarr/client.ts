export class RadarrClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, timeoutMs = 30000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private headers(options: RequestInit): Record<string, string> {
    return {
      "X-Api-Key": this.apiKey,
      ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    };
  }

  private async request(path: string, options: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: this.headers(options),
        signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new Error(`Radarr request timed out after ${this.timeoutMs}ms`, { cause: e });
      }
      throw e;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body}`);
    }
    return res;
  }

  async fetch(path: string, options: RequestInit = {}): Promise<unknown> {
    const res = await this.request(path, options);
    if (res.status === 204) return { success: true };
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return res.json();
    const text = await res.text();
    return text === "" ? { success: true } : text;
  }

  async json(path: string, method: string, body: unknown): Promise<unknown> {
    return this.fetch(path, { method, body: JSON.stringify(body) });
  }
}
