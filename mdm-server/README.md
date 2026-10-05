# mdm-server

Sinatra 製 MDM サーバーの Bun + Hono + drizzle 移植。

## 構成

- `src/index.ts` — Hono アプリの組み立てと起動
- `src/config.ts` — 環境変数の読み込み (`AppConfig`)
- `src/db.ts` — drizzle 接続 (`postgres-js` ドライバ)
- `src/schema.ts` — `Schemafile` と 1:1 のテーブル定義 (29テーブル)
- `src/mdm/` — plist, MDM コマンドビルダ, enrollment profile ビルダ, APNs プッシュ
- `src/ddm/` — リソース識別子・宣言組み立て・ルーター
- `src/dep/` — DEP OAuth1 署名・GetToken JWT・サーバートークン復号・公開鍵証明書
- `src/vpp/` — VPP トークン解析・クライアント・ライセンス付与
- `src/db/` — DB 操作層 (checkin, queue, DDM 取得/管理, 管理画面用 CRUD)
- `src/http/` — セッション・管理画面認証・Google OAuth・MDM Basic 認証
- `src/storage/` — アップロードファイル保存 (S3 / ローカル, Shrine 互換形式)
- `src/routes/` — enrollment, mdm, byod, adde, api, auth, admin, adminDdm
- `src/views/` — hono/jsx ビュー (authenticate + 管理画面全ページ)
- `tests/` — `bun:test` による単体テスト (Ruby 生成ゴールデン付き)

## 使い方

```bash
bun install
DATABASE_URL=postgres://... MDM_SERVER_BASE_URL=https://... bun src/index.ts  # PORT 既定値 3000
```

マイグレーション:

```bash
DATABASE_URL=postgres://... bun run db:migrate
```

## 管理画面

`/` からログイン (Google OAuth 未設定時はデバッグログイン) すると
デバイス・RTS・VPP・IPA・DEP・DDM の管理ページが使える。
OmniAuth の代わりに Google OAuth2 を自前実装している。

認証フロー:

- `POST /auth/developer` → メール入力フォーム → `POST /auth/developer/callback`
- `POST /auth/google_oauth2` → Google → `GET /auth/google_oauth2/callback`
- いずれも `GOOGLE_ALLOWED_DOMAINS` / `GOOGLE_ALLOWED_USERS` で許可判定

## テスト

DB を使うテストは専用 DB に対して実行する:

```bash
TEST_DATABASE_URL=postgres://pguser:pgpassword@localhost:5433/mdm_bun_test bun test
bun run typecheck
bun run db:generate   # drizzle-kit によるマイグレーション生成 (スキーマ検証)
```

Apple のライブエンドポイント (APNs/DEP/VPP) はテストではスタブ化している。
DEP トークン復号・プッシュ証明書・公開鍵証明書のテストは `openssl` CLI を使う。

## Ruby 版からの意図的な差分

- DEP `/dep/...` の POST 系リダイレクトは URL エンコード済み
  (Ruby は未エンコードのまま `redirect` していた)
- DDM device group の「追加なしの削除は無視される」挙動は Ruby 通りに保持
- `Rts::WifiProfile` のファイルなし更新は no-op リダイレクト
  (Ruby は NOT NULL 違反で 500)
- BYOD コマンドフォームの未知コマンドは空ペイロード表示
  (Ruby は特殊コマンド名で 500)
- QR コードは `qrcode` パッケージの SVG 出力 (RQRCode と見た目が多少異なる)
- YAML 表示は `---` ヘッダ付き (Ruby `to_yaml` 互換)
