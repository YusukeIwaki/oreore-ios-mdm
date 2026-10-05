import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { S3Client } from "bun";

/**
 * Uploaded-file storage (replaces Shrine). Files are referenced from the
 * `*_asset_file_data` text columns using the same JSON shape Shrine wrote
 * (`{id, storage, metadata}`) so existing rows keep working.
 */
export interface StoredFile {
  key: string;
  storage: "store" | "cache";
  metadata: {
    filename?: string;
    size?: number;
    mimeType?: string;
  };
}

export function parseStoredFileData(json: string): StoredFile {
  const parsed: unknown = JSON.parse(json);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).id !== "string" ||
    !["store", "cache"].includes((parsed as Record<string, unknown>).storage as string)
  ) {
    throw new TypeError(`invalid asset_file_data: ${json.slice(0, 120)}`);
  }
  const record = parsed as {
    id: string;
    storage: "store" | "cache";
    metadata?: Record<string, unknown>;
  };
  const metadata = record.metadata ?? {};
  return {
    key: record.id,
    storage: record.storage,
    metadata: {
      filename: typeof metadata.filename === "string" ? metadata.filename : undefined,
      size: typeof metadata.size === "number" ? metadata.size : undefined,
      mimeType: typeof metadata.mime_type === "string" ? metadata.mime_type : undefined,
    },
  };
}

export function formatStoredFileData(file: StoredFile): string {
  return JSON.stringify({
    id: file.key,
    storage: file.storage,
    metadata: {
      ...(file.metadata.filename !== undefined ? { filename: file.metadata.filename } : {}),
      ...(file.metadata.size !== undefined ? { size: file.metadata.size } : {}),
      ...(file.metadata.mimeType !== undefined ? { mime_type: file.metadata.mimeType } : {}),
    },
  });
}

export interface FileBackend {
  write(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class S3FileBackend implements FileBackend {
  readonly #client: S3Client;

  constructor(options: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.#client = new S3Client({
      bucket: options.bucket,
      endpoint: options.endpoint,
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
  }

  async write(key: string, data: Uint8Array, contentType?: string): Promise<void> {
    await this.#client.write(key, data, contentType ? { type: contentType } : undefined);
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.#client.file(key).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.#client.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return await this.#client.file(key).exists();
  }
}

export class LocalFileBackend implements FileBackend {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #resolve(key: string): string {
    const resolved = join(this.#root, key);
    if (resolved !== this.#root && !resolved.startsWith(`${this.#root}/`)) {
      throw new Error(`refusing to escape upload dir: ${key}`);
    }
    return resolved;
  }

  async write(key: string, data: Uint8Array, _contentType?: string): Promise<void> {
    const path = this.#resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.#resolve(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.#resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(this.#resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export interface UploadedFile {
  bytes: Uint8Array;
  filename: string;
  contentType?: string;
}

/** Public download URL served by `GET /asset_files/*` (Shrine-compatible shape). */
export function assetFilesUrl(baseUrl: string, stored: StoredFile): string {
  return `${baseUrl}/asset_files/${stored.storage}/${stored.key}`;
}

export class FileStore {
  readonly #primary: FileBackend;
  readonly #legacyCache: FileBackend | null;

  /**
   * @param primary where new uploads go (S3 `store` or local dir).
   * @param legacyCache where Shrine-era `cache` rows are read from, if any.
   */
  constructor(primary: FileBackend, legacyCache: FileBackend | null = null) {
    this.#primary = primary;
    this.#legacyCache = legacyCache;
  }

  static randomKey(filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
    return `${randomBytes(16).toString("hex")}/${safe}`;
  }

  async upload(file: UploadedFile): Promise<StoredFile> {
    const key = FileStore.randomKey(file.filename);
    await this.#primary.write(key, file.bytes, file.contentType);
    return {
      key,
      storage: "store",
      metadata: {
        filename: file.filename,
        size: file.bytes.byteLength,
        mimeType: file.contentType,
      },
    };
  }

  async readStored(stored: StoredFile): Promise<Uint8Array> {
    if (stored.storage === "cache" && this.#legacyCache) {
      return await this.#legacyCache.read(stored.key);
    }
    return await this.#primary.read(stored.key);
  }

  async deleteStored(stored: StoredFile): Promise<void> {
    if (stored.storage === "cache" && this.#legacyCache) {
      await this.#legacyCache.delete(stored.key);
      return;
    }
    await this.#primary.delete(stored.key);
  }
}
