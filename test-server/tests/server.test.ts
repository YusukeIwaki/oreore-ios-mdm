import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleRequest } from "../src/server";

const ORIGINAL_BASE_URL = process.env.MDM_SERVER_BASE_URL;

beforeEach(() => {
  process.env.MDM_SERVER_BASE_URL = "https://mdm.example.com";
});

afterEach(() => {
  process.env.MDM_SERVER_BASE_URL = ORIGINAL_BASE_URL;
});

describe("GET /.well-known/com.apple.remotemanagement", () => {
  test("returns the ADDE enrollment URL when model-family is present", async () => {
    const res = handleRequest(
      new Request(
        "https://test-server/.well-known/com.apple.remotemanagement?user-identifier=user@example.com&model-family=iPhone",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({
      Servers: [{ Version: "mdm-adde", BaseURL: "https://mdm.example.com/mdm-adde/enroll" }],
    });
  });

  test("returns the BYOD enrollment URL when model-family is absent", async () => {
    const res = handleRequest(
      new Request(
        "https://test-server/.well-known/com.apple.remotemanagement?user-identifier=user@example.com",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      Servers: [{ Version: "mdm-byod", BaseURL: "https://mdm.example.com/mdm-byod/enroll" }],
    });
  });

  test("honors MDM_SERVER_BASE_URL", async () => {
    process.env.MDM_SERVER_BASE_URL = "https://other.example.net";
    const res = handleRequest(
      new Request("https://test-server/.well-known/com.apple.remotemanagement"),
    );
    expect(await res.json()).toEqual({
      Servers: [{ Version: "mdm-byod", BaseURL: "https://other.example.net/mdm-byod/enroll" }],
    });
  });

  test("returns 404 for unknown paths", async () => {
    const res = handleRequest(new Request("https://test-server/unknown"));
    expect(res.status).toBe(404);
  });
});
