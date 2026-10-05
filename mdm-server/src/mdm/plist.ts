import { build, parse } from "plist";

/**
 * Serialize a payload to XML plist (mirrors Ruby `Hash#to_plist`).
 * `Buffer`/`Uint8Array` values become `<data>`, like Ruby `StringIO`.
 */
export function buildPlist(payload: unknown): string {
  return build(payload as Parameters<typeof build>[0]);
}

/** Parse XML plist. Note `<data>` comes back as `Uint8Array`, not `Buffer`. */
export function parsePlist(xml: string): unknown {
  return parse(xml);
}

/** Normalize plist `<data>` to `Buffer` for byte comparison. */
export function dataToBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  throw new TypeError(`expected plist <data>, got ${typeof value}`);
}
