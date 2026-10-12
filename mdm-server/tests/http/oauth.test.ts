import { describe, expect, test } from "bun:test";
import {
  authorizeRedirectUrl,
  callbackReturnUrl,
  exchangeCodeForUserinfo,
} from "../../src/http/oauth";
import { loginAllowed } from "../../src/http/adminAuth";

describe("admin auth rules", () => {
  test("loginAllowed matches domains and users without trimming", () => {
    expect(loginAllowed("a@example.com", { allowedDomains: ["example.com"], allowedUsers: [] })).toBe(true);
    expect(loginAllowed("a@example.com", { allowedDomains: ["other.com"], allowedUsers: [] })).toBe(false);
    expect(loginAllowed("a@example.com", { allowedDomains: [], allowedUsers: ["a@example.com"] })).toBe(true);
    // No trimming, like the Ruby split(',').include? checks.
    expect(loginAllowed("a@example.com", { allowedDomains: [" example.com"], allowedUsers: [] })).toBe(false);
    expect(loginAllowed("a@example.com", { allowedDomains: [], allowedUsers: [] })).toBe(false);
  });

  test("callbackReturnUrl drops blank and /auth/ targets", () => {
    expect(callbackReturnUrl(undefined)).toBe("/");
    expect(callbackReturnUrl("")).toBe("/");
    expect(callbackReturnUrl("/auth/google_oauth2")).toBe("/");
    expect(callbackReturnUrl("/devices/abc")).toBe("/devices/abc");
  });
});

describe("Google OAuth", () => {
  const config = { clientId: "cid", clientSecret: "csecret" };

  test("authorizeRedirectUrl carries the standard parameters", () => {
    const url = new URL(authorizeRedirectUrl(config, "https://mdm.example.com", "state-1"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://mdm.example.com/auth/google_oauth2/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  test("exchangeCodeForUserinfo posts the code then reads userinfo", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("token")) {
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body ?? ""));
        expect(body.get("code")).toBe("auth-code");
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({ access_token: "at-1", token_type: "Bearer" });
      }
      expect(init?.headers).toMatchObject({ Authorization: "Bearer at-1" });
      return Response.json({ email: "user@example.com", email_verified: true });
    }) as unknown as typeof fetch;
    const userinfo = await exchangeCodeForUserinfo(
      { ...config, fetchFn },
      "https://mdm.example.com",
      "auth-code",
    );
    expect(userinfo).toEqual({ email: "user@example.com", emailVerified: true });
    expect(seen).toHaveLength(2);
  });

  test("exchangeCodeForUserinfo rejects failures loudly", async () => {
    const failing = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
    await expect(
      exchangeCodeForUserinfo({ ...config, fetchFn: failing }, "https://mdm.example.com", "c"),
    ).rejects.toThrow("token exchange failed");
    const noToken = (async () => Response.json({})) as unknown as typeof fetch;
    await expect(
      exchangeCodeForUserinfo({ ...config, fetchFn: noToken }, "https://mdm.example.com", "c"),
    ).rejects.toThrow("no access_token");
    const noEmail = (async (url: string | URL | Request) =>
      String(url).includes("token")
        ? Response.json({ access_token: "at" })
        : Response.json({ email_verified: true })) as unknown as typeof fetch;
    await expect(
      exchangeCodeForUserinfo({ ...config, fetchFn: noEmail }, "https://mdm.example.com", "c"),
    ).rejects.toThrow("no email");
  });
});
