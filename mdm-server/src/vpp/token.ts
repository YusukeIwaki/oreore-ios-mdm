/**
 * VPP content-token parsing (pure part of `VppContentToken.update_from`).
 */

export interface ParsedVppToken {
  /** Raw base64 token, stored verbatim. */
  value: string;
  expDate: Date;
}

export function parseVppToken(ctoken: string): ParsedVppToken {
  const decoded: unknown = JSON.parse(Buffer.from(ctoken, "base64").toString("utf8"));
  const expDateRaw =
    typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>).expDate
      : undefined;
  if (typeof expDateRaw !== "string") {
    throw new TypeError("VPP token has no expDate");
  }
  const expDate = new Date(expDateRaw);
  if (Number.isNaN(expDate.getTime())) {
    throw new TypeError(`VPP token has an invalid expDate: ${expDateRaw}`);
  }
  return { value: ctoken, expDate };
}

export function urlEncodeFilename(filename: string): string {
  return encodeURIComponent(filename);
}
