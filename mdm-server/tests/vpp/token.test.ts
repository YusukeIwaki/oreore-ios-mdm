import { describe, expect, test } from "bun:test";
import { parseVppToken, urlEncodeFilename } from "../../src/vpp/token";

describe("VPP content token", () => {
  test("parses expDate from the base64 token", () => {
    const ctoken = Buffer.from(
      JSON.stringify({ token: "location-token", expDate: "2025-05-01T00:00:00Z", orgName: "Acme" }),
    ).toString("base64");
    expect(parseVppToken(ctoken)).toEqual({
      value: ctoken,
      expDate: new Date("2025-05-01T00:00:00Z"),
    });
  });

  test("rejects malformed tokens", () => {
    expect(() => parseVppToken("!!!not-base64-json")).toThrow();
    expect(() => parseVppToken(Buffer.from(JSON.stringify({})).toString("base64"))).toThrow(
      TypeError,
    );
    expect(() =>
      parseVppToken(Buffer.from(JSON.stringify({ expDate: "not-a-date" })).toString("base64")),
    ).toThrow(TypeError);
  });

  test("urlEncodeFilename encodes spaces", () => {
    expect(urlEncodeFilename("my token.vpptoken")).toBe("my%20token.vpptoken");
  });
});
