import { Hono } from "hono";
import { loadConfig, type AppConfig } from "./config";
import { createDb, type Database } from "./db";
import { appContext, type AppEnv, type AppVariables } from "./http/context";
import { FileStore, LocalFileBackend, S3FileBackend } from "./storage/files";
import { addeRoutes } from "./routes/adde";
import { adminDdmRoutes } from "./routes/adminDdm";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { authRoutes } from "./routes/auth";
import { byodRoutes } from "./routes/byod";
import { enrollmentRoutes } from "./routes/enrollment";
import { mdmRoutes } from "./routes/mdm";

export interface AppDependencies {
  config: AppConfig;
  db: Database;
  fileStore: FileStore;
  sendPush?: AppVariables["sendPush"];
  depClientFor?: AppVariables["depClientFor"];
  vppClientFor?: AppVariables["vppClientFor"];
  googleOAuth?: AppVariables["googleOAuth"];
}

export function createFileStore(config: AppConfig): FileStore {
  if (config.s3) {
    return new FileStore(new S3FileBackend(config.s3));
  }
  return new FileStore(new LocalFileBackend(config.uploadDir));
}

export function createApp(deps: AppDependencies) {
  const app = new Hono<AppEnv>();
  app.use(appContext(deps));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/", enrollmentRoutes);
  app.route("/", mdmRoutes);
  app.route("/", byodRoutes);
  app.route("/", addeRoutes);
  app.route("/", apiRoutes);
  app.route("/", authRoutes);
  app.route("/", adminRoutes);
  app.route("/", adminDdmRoutes);

  return app;
}

if (import.meta.main) {
  const config = loadConfig(process.env);
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!config.baseUrl) {
    throw new Error("MDM_SERVER_BASE_URL is not set");
  }
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET is not set: sessions reset on every restart");
  }
  if (!config.s3) {
    console.warn("S3 is not configured: uploads live on ephemeral disk (UPLOAD_DIR)");
  }
  const db = createDb(config.databaseUrl);
  const app = createApp({ config, db, fileStore: createFileStore(config) });
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`mdm-server listening on http://localhost:${server.port}`);
}
