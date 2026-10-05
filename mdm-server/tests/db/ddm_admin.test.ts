import { describe, expect, test } from "bun:test";
import {
  isBlank,
  parseIdParam,
  parsePayloadYaml,
  parseSerialNumbers,
  RecordNotFound,
  ValidationError,
} from "../../src/db/ddm_admin";

describe("DDM admin input helpers", () => {
  test("isBlank follows Ruby blank? for JSON/YAML values", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(false)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank({})).toBe(true);
    expect(isBlank(true)).toBe(false);
    expect(isBlank(0)).toBe(false);
    expect(isBlank("x")).toBe(false);
    expect(isBlank([0])).toBe(false);
    expect(isBlank({ a: 1 })).toBe(false);
  });

  test("parseIdParam rejects non-integer ids like ActiveRecord", () => {
    expect(parseIdParam("42")).toBe(42);
    expect(() => parseIdParam("hoge")).toThrow(RecordNotFound);
    expect(() => parseIdParam("1.5")).toThrow(RecordNotFound);
  });

  test("parsePayloadYaml parses YAML and enforces presence", () => {
    expect(parsePayloadYaml("key: value")).toEqual({ key: "value" });
    expect(() => parsePayloadYaml("")).toThrow(ValidationError);
    expect(() => parsePayloadYaml(undefined)).toThrow(ValidationError);
    expect(() => parsePayloadYaml("---\n")).toThrow(ValidationError);
    expect(() => parsePayloadYaml("[unclosed")).toThrow();
  });

  test("parseSerialNumbers splits, strips, and drops blanks", () => {
    expect(parseSerialNumbers("S1\n  S2  \n\n")).toEqual(["S1", "S2"]);
    expect(parseSerialNumbers(undefined)).toEqual([]);
    expect(parseSerialNumbers("")).toEqual([]);
  });
});
