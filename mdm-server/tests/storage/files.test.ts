import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  FileStore,
  formatStoredFileData,
  LocalFileBackend,
  parseStoredFileData,
  S3FileBackend,
} from "../../src/storage/files";

describe("stored file data", () => {
  test("round-trips Shrine-shaped JSON", () => {
    const json = formatStoredFileData({
      key: "abc/file.mobileconfig",
      storage: "store",
      metadata: { filename: "file.mobileconfig", size: 12, mimeType: "text/xml" },
    });
    expect(JSON.parse(json)).toEqual({
      id: "abc/file.mobileconfig",
      storage: "store",
      metadata: { filename: "file.mobileconfig", size: 12, mime_type: "text/xml" },
    });
    expect(parseStoredFileData(json)).toEqual({
      key: "abc/file.mobileconfig",
      storage: "store",
      metadata: { filename: "file.mobileconfig", size: 12, mimeType: "text/xml" },
    });
  });

  test("reads legacy cache rows and rejects garbage", () => {
    expect(
      parseStoredFileData('{"id":"k","storage":"cache","metadata":{}}').storage,
    ).toBe("cache");
    expect(() => parseStoredFileData("{}")).toThrow(TypeError);
    expect(() => parseStoredFileData("nope")).toThrow();
  });
});

describe("local backend", () => {
  test("upload/read/delete round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uploads-"));
    try {
      const store = new FileStore(new LocalFileBackend(dir));
      const stored = await store.upload({
        bytes: new TextEncoder().encode("hello"),
        filename: "hello.txt",
        contentType: "text/plain",
      });
      expect(stored.metadata).toMatchObject({ filename: "hello.txt", size: 5 });
      expect(new TextDecoder().decode(await store.readStored(stored))).toBe("hello");
      await store.deleteStored(stored);
      await expect(store.readStored(stored)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("S3 backend", () => {
  const endpoint = process.env.TEST_S3_ENDPOINT ?? "http://localhost:4566";
  const bucket = process.env.TEST_S3_BUCKET ?? "oreore-ios-mdm-test";

  test("upload/read/delete round-trip against floci", async () => {
    const prefix = `bun-test-${Date.now()}`;
    const backend = new S3FileBackend({
      bucket,
      endpoint,
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test",
    });
    const key = `${prefix}/hello.txt`;
    await backend.write(key, new TextEncoder().encode("hello-s3"), "text/plain");
    expect(await backend.exists(key)).toBe(true);
    expect(new TextDecoder().decode(await backend.read(key))).toBe("hello-s3");
    await backend.delete(key);
    expect(await backend.exists(key)).toBe(false);
  });
});
