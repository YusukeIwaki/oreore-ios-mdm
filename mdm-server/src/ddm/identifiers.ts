import { createHash } from "node:crypto";

/**
 * DDM resource identifiers and `@type/name` reference resolution
 * (ported from `models/ddm/resource_identifier.rb` and
 * `resource_identifier_resolvable.rb`).
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** OID namespace, same as Ruby `Digest::UUID::OID_NAMESPACE`. */
export const OID_NAMESPACE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

export function uuidv5(name: string, namespace: string = OID_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}` +
    `-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

export type ResourceType = "activation" | "asset" | "configuration" | "management" | "property";

export interface ResourceIdentifier {
  basename: string;
  referenceName: string;
  digest: string;
}

export function resourceIdentifier(type: ResourceType, name: string): ResourceIdentifier {
  const referenceName = `@${type}/${name}`;
  return { basename: name, referenceName, digest: uuidv5(referenceName) };
}

/**
 * Ruby `/\A@[a-z]+\/[a-zA-Z0-9._-]+\z/`. The explicit newline check emulates
 * `\z`, which JS `$` does not (it tolerates one trailing `\n`).
 */
const REFERENCE_PATTERN = /^@[a-z]+\/[a-zA-Z0-9._-]+$/;

export function isResourceReference(value: unknown): value is string {
  return (
    typeof value === "string" && !value.includes("\n") && REFERENCE_PATTERN.test(value)
  );
}

/** Deep-collect `@type/name` strings from values (keys are not scanned). */
export function collectResourceIdentifiers(payload: JsonValue): string[] {
  const found = new Set<string>();
  const walk = (node: JsonValue): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const value of Object.values(node)) {
        walk(value);
      }
      return;
    }
    if (isResourceReference(node)) {
      found.add(node);
    }
  };
  walk(payload);
  return [...found];
}

export function collectRequiredResourceIdentifiers(
  payload: JsonValue,
  candidates: string[],
): string[] {
  const candidateSet = new Set(candidates);
  return collectResourceIdentifiers(payload).filter((reference) => candidateSet.has(reference));
}

export class InsufficientResourceIdentifiers extends Error {
  constructor(missing: string[]) {
    super(`Required resource_identifiers: [${missing.join(", ")}]`);
    this.name = "InsufficientResourceIdentifiers";
  }
}

/** Deep-replace references using `map` (missing keys become `null`). */
export function replaceResourceIdentifiers(
  payload: JsonValue,
  map: Record<string, JsonValue>,
): JsonValue {
  if (Array.isArray(payload)) {
    return payload.map((item) => replaceResourceIdentifiers(item, map));
  }
  if (payload !== null && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, replaceResourceIdentifiers(value, map)]),
    );
  }
  if (isResourceReference(payload)) {
    return map[payload] ?? null;
  }
  return payload;
}

/** Replace references, raising when any collected reference lacks a mapping. */
export function resolvedPayload(
  payload: JsonValue,
  map: Record<string, JsonValue>,
): JsonValue {
  const missing = collectResourceIdentifiers(payload).filter(
    (reference) => !(reference in map),
  );
  if (missing.length > 0) {
    throw new InsufficientResourceIdentifiers(missing);
  }
  return replaceResourceIdentifiers(payload, map);
}
