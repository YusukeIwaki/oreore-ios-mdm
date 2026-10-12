import { describe, expect, test } from "bun:test";
import { testApp } from "./helpers/app";

describe("app", () => {
  test("GET /health", async () => {
    const { app } = await testApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
