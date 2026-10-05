import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../config";
import type { Database } from "../db";
import type { FileStore } from "../storage/files";

export interface DepClientLike {
  get(path: string, params?: Record<string, string>): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  put(path: string, body?: unknown): Promise<unknown>;
  delete(path: string, body?: unknown): Promise<unknown>;
}

export interface VppClientLike {
  get(path: string, params?: Record<string, string>): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  fetchAppInformation(adamId: string | number): Promise<unknown>;
}

export interface GoogleOAuthTestHooks {
  authorizeUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  fetchFn?: typeof fetch;
}

export interface AppVariables {
  config: AppConfig;
  db: Database;
  fileStore: FileStore;
  /** APNs sender seam (tests inject a stub; production uses the real client). */
  sendPush?: (endpoint: { token: string; pushMagic: string }) => Promise<unknown>;
  /** Apple DEP/VPP client seams (tests inject stubs; production uses live clients). */
  depClientFor?: (credentials: {
    consumerKey: string;
    consumerSecret: string;
    accessToken: string;
    accessSecret: string;
  }) => DepClientLike;
  vppClientFor?: (tokenValue: string) => VppClientLike;
  /** Google OAuth endpoint overrides for tests. */
  googleOAuth?: GoogleOAuthTestHooks;
}

export type AppEnv = { Bindings: Record<string, never>; Variables: AppVariables };

/** Attach per-request dependencies (injected for tests, real in production). */
export function appContext(data: AppVariables) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("config", data.config);
    c.set("db", data.db);
    c.set("fileStore", data.fileStore);
    if (data.sendPush) {
      c.set("sendPush", data.sendPush);
    }
    if (data.depClientFor) {
      c.set("depClientFor", data.depClientFor);
    }
    if (data.vppClientFor) {
      c.set("vppClientFor", data.vppClientFor);
    }
    if (data.googleOAuth) {
      c.set("googleOAuth", data.googleOAuth);
    }
    await next();
  });
}
