# CLAUDE.md

## Project Overview

Sinatra (Ruby) ベースの iOS MDM サーバー。PostgreSQL + ActiveRecord (sinatra-activerecord) を使用。
スキーマ管理は Ridgepole (`Schemafile`)。

## Deployment: Railway

- **Project:** `e7259edf-c46e-43a9-8e77-3ff210e2b6cf`
- **Service:** `f35fb30b-cf63-43db-b290-4f7ac4e601b6` (oreore-ios-mdm)
- **Environment:** `dbb366d3-b78e-4752-8807-50b5b1b5ab8e` (production)
- **Domain:** `iwaki-ios-mdm.up.railway.app`
- **ビルダー:** Railpack (Dockerfileではない)

### Railpack ビルドの前提

- リポジトリのルートに `Dockerfile` という名前のファイルがあると Railway は自動的に Dockerfile ビルドを使う。Railpack を使うには `Dockerfile` を置かないこと。
- 開発用・本番用の Dockerfile は `Dockerfile.dev`, `Dockerfile.prod.bak` にリネーム済み。
- 起動コマンドは `Procfile` で定義: `web: bundle exec rackup --host 0.0.0.0 --port $PORT`

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
3. `railway up` でデプロイ
4. 必要に応じて `railway run ridgepole --apply -f Schemafile -c '{"adapter":"postgresql","url":"$DATABASE_URL"}'` でスキーマ適用

## Heroku (旧デプロイ先)

- App: `oreore-ios-mdm`
- 環境変数は `heroku config --app oreore-ios-mdm` で確認可能
- Heroku の環境変数を Railway に移行する際は `heroku config:get <KEY> --app oreore-ios-mdm` で取得して `railway variable set --skip-deploys` で設定
