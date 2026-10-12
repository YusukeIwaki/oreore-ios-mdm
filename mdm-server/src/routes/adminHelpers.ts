import type { Context } from "hono";
import type { AppEnv, DepClientLike, VppClientLike } from "../http/context";
import type { UploadedFile } from "../storage/files";
import { DepClient } from "../dep/client";
import { VppClient } from "../vpp/client";
import { getPushIdentity, sendMdmNotification } from "../mdm/push";

/** Shared helpers for the admin console routes. */
export async function uploadedFile(value: unknown): Promise<UploadedFile | null> {
  // An untouched file input arrives as a nameless zero-size File: no upload.
  if (!(value instanceof File) || (value.name === "" && value.size === 0)) {
    return null;
  }
  return {
    bytes: new Uint8Array(await value.arrayBuffer()),
    filename: value.name,
    contentType: value.type || undefined,
  };
}

export function textField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Multi-checkbox field (`device_identifiers[]`), tolerating Hono's key shape. */
export function multiValues(body: Record<string, unknown>, name: string): string[] {
  const raw = body[name] ?? body[`${name}[]`];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.filter((value): value is string => typeof value === "string" && value !== "");
}

export function pushSender(c: Context<AppEnv>) {
  const stub = c.get("sendPush");
  if (stub) {
    return stub;
  }
  const config = c.get("config");
  return (endpoint: { token: string; pushMagic: string }) =>
    sendMdmNotification(getPushIdentity(config), endpoint);
}

export function depClientFor(
  c: Context<AppEnv>,
  token: { consumerKey: string; consumerSecret: string; accessToken: string; accessSecret: string },
): DepClientLike {
  const factory = c.get("depClientFor");
  return factory ? factory(token) : new DepClient(token);
}

export function vppClientFor(c: Context<AppEnv>, tokenValue: string): VppClientLike {
  const factory = c.get("vppClientFor");
  return factory ? factory(tokenValue) : new VppClient(tokenValue);
}

/** Shape the Ruby `rescue => e` + `e.response.body` error display. */
export function appleError(error: unknown): { message: string; body?: string } {
  if (error && typeof error === "object" && "status" in error && "body" in error) {
    const depError = error as unknown as { message: string; body: unknown };
    return {
      message: String(depError.message ?? error),
      body: typeof depError.body === "string" ? depError.body : undefined,
    };
  }
  return { message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}
