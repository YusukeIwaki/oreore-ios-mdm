import { describe, expect, test } from "bun:test";
import { buildAuthorizationHeader, depApiHeaders } from "../../src/dep/oauth";

const CREDENTIALS = {
  consumerKey: "CK_12345",
  consumerSecret: "CS/abc+def=",
  accessToken: "AT_67890",
  accessSecret: "AS_xyz/123+",
};

describe("DEP OAuth1 signing", () => {
  test("matches the Ruby AuthSession header byte-for-byte", () => {
    expect(
      buildAuthorizationHeader(CREDENTIALS, {
        nonce: "0123456789abcdef0123456789abcdef",
        timestamp: "1700000000",
      }),
    ).toBe(
      'OAuth oauth_consumer_key="CK_12345", oauth_token="AT_67890", ' +
        'oauth_signature_method="HMAC-SHA1", oauth_timestamp="1700000000", ' +
        'oauth_nonce="0123456789abcdef0123456789abcdef", oauth_version="1.0", ' +
        'oauth_signature="x%2BB%2B7G5CuMS8RnuNl2XC0%2B9cGsk%3D", realm="ADM"',
    );
  });

  test("generates nonce and timestamp by default", () => {
    const first = buildAuthorizationHeader(CREDENTIALS);
    const second = buildAuthorizationHeader(CREDENTIALS);
    expect(first).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
    expect(first).toMatch(/oauth_timestamp="\d+"/);
    expect(first).not.toBe(second);
  });

  test("API headers match exactly", () => {
    expect(depApiHeaders("session-token")).toEqual({
      "X-ADM-Auth-Session": "session-token",
      "X-Server-Protocol-Version": "3",
      "Content-Type": "application/json;charset=UTF8",
    });
  });
});
