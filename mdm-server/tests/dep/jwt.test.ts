import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { mintGetToken, verifyGetToken } from "../../src/dep/jwt";

const fixtures = join(import.meta.dir, "..", "fixtures");
const readFixture = (name: string): string => readFileSync(join(fixtures, name), "utf8").trim();

describe("GetToken JWT", () => {
  test("verifies a Ruby-minted token", async () => {
    const claims = await verifyGetToken(
      readFixture("get_token_jwt.pub"),
      readFixture("get_token_jwt.txt"),
    );
    expect(claims).toMatchObject({
      service_type: "com.apple.maid",
      iss: "server-uuid-1234",
      iat: 1700000000,
      jti: "jti-fixed-uuid",
    });
  });

  test("minted tokens verify and preserve header and claim order", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const token = await mintGetToken(privatePem, {
      service_type: "com.apple.maid",
      iss: "server-uuid-1234",
      iat: 1700000000,
      jti: "jti-fixed-uuid",
    });
    const [headerSegment, payloadSegment] = token.split(".");
    expect(Buffer.from(headerSegment!, "base64url").toString("utf8")).toBe('{"alg":"RS256"}');
    expect(Buffer.from(payloadSegment!, "base64url").toString("utf8")).toBe(
      '{"service_type":"com.apple.maid","iss":"server-uuid-1234","iat":1700000000,"jti":"jti-fixed-uuid"}',
    );

    const claims = await verifyGetToken(publicPem, token);
    expect(claims).toMatchObject({ iss: "server-uuid-1234", jti: "jti-fixed-uuid" });

    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(
      verifyGetToken(other.publicKey.export({ type: "spki", format: "pem" }).toString(), token),
    ).rejects.toThrow();
  });
});
