/**
 * Apple VPP API client (ported from `VppClient`).
 */
export class VppError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`VPP request failed with status ${status}: ${body.slice(0, 200)}`);
    this.name = "VppError";
    this.status = status;
    this.body = body;
  }
}

export interface VppClientOptions {
  baseUrl?: string;
  lookupBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export class VppClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #lookupBaseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(tokenValue: string, options: VppClientOptions = {}) {
    this.#token = tokenValue;
    this.#baseUrl = (options.baseUrl ?? "https://vpp.itunes.apple.com/mdm/v2").replace(/\/$/, "");
    this.#lookupBaseUrl =
      options.lookupBaseUrl ?? "https://uclient-api.itunes.apple.com";
    this.#fetch = options.fetchFn ?? fetch;
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.#baseUrl}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    return await this.#json("GET", url.toString());
  }

  async post(path: string, body: unknown = {}): Promise<unknown> {
    return await this.#json("POST", `${this.#baseUrl}/${path.replace(/^\//, "")}`, body);
  }

  async fetchAppInformation(adamId: string | number): Promise<unknown> {
    const url = new URL(
      `${this.#lookupBaseUrl}/WebObjects/MZStorePlatform.woa/wa/lookup`,
    );
    url.searchParams.set("id", String(adamId));
    url.searchParams.set("version", "2");
    url.searchParams.set("p", "mdm-lockup");
    url.searchParams.set("caller", "MDM");
    url.searchParams.set("platform", "enterprisestore");
    url.searchParams.set("cc", "jp");
    url.searchParams.set("l", "ja");
    const response = await this.#fetch(url.toString());
    const text = await response.text();
    if (!response.ok) {
      throw new VppError(response.status, text);
    }
    const parsed = JSON.parse(text) as { results?: Record<string, unknown> };
    return parsed.results?.[String(adamId)];
  }

  async #json(method: string, url: string, body?: unknown): Promise<unknown> {
    const response = await this.#fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new VppError(response.status, text);
    }
    return JSON.parse(text);
  }
}
