import { buildAuthorizationHeader, depApiHeaders, type DepCredentials } from "./oauth";

/**
 * Apple DEP API client (ported from `DepClient`): OAuth1 session tokens,
 * 401-only retries with token refresh, JSON in/out.
 */
export class DepError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`DEP request failed with status ${status}: ${body.slice(0, 200)}`);
    this.name = "DepError";
    this.status = status;
    this.body = body;
  }
}

export interface DepClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Base retry delay in ms (Ruby: interval 1s, backoff ×2, jitter 0.5). */
  retryDelayMs?: number;
  maxRetries?: number;
}

export class DepClient {
  readonly #credentials: DepCredentials;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #retryDelayMs: number;
  readonly #maxRetries: number;
  #authSessionToken: string | null = null;

  constructor(
    credentials: { consumerKey: string; consumerSecret: string; accessToken: string; accessSecret: string },
    options: DepClientOptions = {},
  ) {
    this.#credentials = credentials;
    this.#baseUrl = (options.baseUrl ?? "https://mdmenrollment.apple.com").replace(/\/$/, "");
    this.#fetch = options.fetchFn ?? fetch;
    this.#retryDelayMs = options.retryDelayMs ?? 1000;
    this.#maxRetries = options.maxRetries ?? 3;
  }

  async fetchSessionToken(): Promise<string> {
    const response = await this.#fetch(`${this.#baseUrl}/session`, {
      headers: { Authorization: buildAuthorizationHeader(this.#credentials) },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new DepError(response.status, text);
    }
    const parsed = JSON.parse(text) as { auth_session_token?: unknown };
    if (typeof parsed.auth_session_token !== "string") {
      throw new DepError(response.status, text);
    }
    this.#authSessionToken = parsed.auth_session_token;
    return parsed.auth_session_token;
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    if (params && Object.keys(params).length > 0) {
      const query = new URLSearchParams(params).toString();
      return await this.#request("GET", `${path}?${query}`);
    }
    return await this.#request("GET", path);
  }

  async post(path: string, body: unknown = {}): Promise<unknown> {
    return await this.#request("POST", path, body);
  }

  async put(path: string, body: unknown = {}): Promise<unknown> {
    return await this.#request("PUT", path, body);
  }

  /** DEP DELETE calls carry a JSON body (`nil.to_json` → `"null"` when empty). */
  async delete(path: string, body: unknown = null): Promise<unknown> {
    return await this.#request("DELETE", path, body);
  }

  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (this.#authSessionToken === null) {
      await this.fetchSessionToken();
    }
    let attempt = 0;
    for (;;) {
      const response = await this.#fetch(`${this.#baseUrl}/${path.replace(/^\//, "")}`, {
        method,
        headers: depApiHeaders(this.#authSessionToken!),
        body: method === "GET" ? undefined : JSON.stringify(body ?? null),
      });
      const text = await response.text();
      if (response.status === 401 && attempt < this.#maxRetries) {
        await this.fetchSessionToken();
        await Bun.sleep(this.#retryDelayMs * 2 ** attempt * (1 + Math.random() * 0.5));
        attempt += 1;
        continue;
      }
      if (!response.ok) {
        throw new DepError(response.status, text);
      }
      return JSON.parse(text);
    }
  }
}
