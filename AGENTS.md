# AGENTS.md

## Project Overview

iOS MDM サーバー。3つの独立コンポーネント (相互に依存なし):

- `mdm-server/` — Web サーバー本体 (Bun + Hono + drizzle, PostgreSQL)
- `mdm-tools/` — 証明書・鍵・署名ユーティリティ群 (Rust)
- `test-server/` — `.well-known` 配信用テストサーバー (Bun 単体)

スキーマ管理は drizzle (`mdm-server/drizzle/`, 定義は `mdm-server/src/schema.ts`)。
詳細は各ディレクトリの README、デプロイ手順は `mdm-server/RAILWAY.md` を参照。

## Deployment: Railway

- **Project:** `e7259edf-c46e-43a9-8e77-3ff210e2b6cf`
- **Service:** `f35fb30b-cf63-43db-b290-4f7ac4e601b6` (oreore-ios-mdm)
- **Environment:** `dbb366d3-b78e-4752-8807-50b5b1b5ab8e` (production)
- **Domain:** `iwaki-ios-mdm.up.railway.app`
- **ビルダー:** Railpack (Dockerfileではない)
- **Root Directory:** `mdm-server` (サービス設定で指定)

### Railpack ビルドの前提

- リポジトリのルートに `Dockerfile` という名前のファイルがあると Railway は自動的に Dockerfile ビルドを使う。Railpack を使うには `Dockerfile` を置かないこと。
- 起動コマンドは `mdm-server/railway.toml` で定義 (`bun run start` = migrate 後にサーバー起動)。

### 環境変数の設定

- **`--skip-deploys` フラグを必ず使う。** `railway variable set` はデフォルトで変更のたびにデプロイをトリガーする。複数の変数を設定するときは `railway variable set --skip-deploys KEY=VALUE` を使うこと。
- `DATABASE_URL` は Postgres サービスへの参照変数: `${{Postgres.DATABASE_URL}}`
- `MDM_SERVER_BASE_URL` は `https://iwaki-ios-mdm.up.railway.app`

### Railway CLI の注意点

- `railway link` でプロジェクトをリンクしてから操作する
- `railway add` や `railway domain` など一部コマンドは権限エラーになることがある。その場合はダッシュボードから操作する
- デプロイは `railway up` (ローカルファイルを直接アップロード)

### デプロイ手順

1. `railway link --project <id> --service <id> --environment <id>`
2. 環境変数の設定 (`railway variable set --skip-deploys ...`)
3. `railway up` でデプロイ (起動時に `drizzle-kit migrate` が自動実行される)

## テスト

```bash
cargo test -p mdm-tools                        # Rust (mdm-tools/ で cargo test でも可)
TEST_DATABASE_URL=postgres://... bun test      # mdm-server/ で実行
bun test                                       # test-server/ で実行
```

`mdm-server` のテストは PostgreSQL と floci (S3互換ストレージ) が必要。
`TEST_DATABASE_URL` が指す DB は `DATABASE_URL=<test-url> bun run db:migrate` で事前にマイグレーションしておくこと。
型チェックは各 Bun ディレクトリで `bun run typecheck`。

## Heroku (旧デプロイ先)

- App: `oreore-ios-mdm`
- 環境変数は `heroku config --app oreore-ios-mdm` で確認可能
- Heroku の環境変数を Railway に移行する際は `heroku config:get <KEY> --app oreore-ios-mdm` で取得して `railway variable set --skip-deploys` で設定
