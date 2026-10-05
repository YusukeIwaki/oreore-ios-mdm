import { describe, expect, test } from "bun:test";
import { associateLicense, validateLicenseForm } from "../../src/vpp/license";

describe("VPP license form", () => {
  test("validateLicenseForm requires both fields", () => {
    expect(validateLicenseForm({ adam_id: "1", serial_number: "S1" })).toBe(true);
    expect(validateLicenseForm({ adam_id: "", serial_number: "S1" })).toBe(false);
    expect(validateLicenseForm({ adam_id: "1", serial_number: "" })).toBe(false);
    expect(validateLicenseForm({})).toBe(false);
  });

  test("associateLicense posts the association then polls until settled", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    let polls = 0;
    const client = {
      post: async (path: string, body: unknown) => {
        calls.push({ method: "POST", path, body });
        return { eventId: "event-1" };
      },
      get: async (path: string, params?: Record<string, string>) => {
        calls.push({ method: "GET", path, body: params });
        polls += 1;
        return { eventStatus: polls < 3 ? "PENDING" : "COMPLETED" };
      },
    };
    const sleeps: number[] = [];
    await associateLicense(
      client,
      { adam_id: "123", serial_number: "SN1" },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(calls[0]).toEqual({
      method: "POST",
      path: "assets/associate",
      body: { assets: [{ adamId: "123" }], serialNumbers: ["SN1"] },
    });
    expect(polls).toBe(3);
    expect(sleeps).toEqual([600, 600]);
  });

  test("associateLicense gives up after 10 polls", async () => {
    let polls = 0;
    const client = {
      post: async () => ({ eventId: "event-9" }),
      get: async () => {
        polls += 1;
        return { eventStatus: "PENDING" };
      },
    };
    await associateLicense(client, { adam_id: "1", serial_number: "S" }, async () => {});
    expect(polls).toBe(10);
  });
});
