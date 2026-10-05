# Railway デプロイ手順 (mdm-server)

Railpack ビルダーでデプロイする。リポジトリルートに `Dockerfile` を置くと
Railway が Dockerfile ビルドに切り替わるため、置かないこと
(既存の `Dockerfile.dev` 等はリネーム済み)。

## 1. サービス設定 (ダッシュボード)

- **Root Directory**: `mdm-server`
  (サービス Settings > Source > Root Directory)
- デプロイは `railway up` (リポジトリルートから実行)
- ヘルスチェックは `railway.toml` で `/health` を指定済み

## 2. 環境変数

`railway variable set` はデフォルトで毎回デプロイをトリガーするため、
**必ず `--skip-deploys` を付けて**設定する。

```bash
railway link --project <project> --service <service> --environment <environment>
railway variable set --skip-deploys DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variable set --skip-deploys MDM_SERVER_BASE_URL=https://<your-domain>
# ...以下同様
```

### 必須

| 変数 | 説明 |
|---|---|
| `DATABASE_URL` | Postgres への参照変数 (`${{Postgres.DATABASE_URL}}`) |
| `MDM_SERVER_BASE_URL` | 公開 URL (`https://...`)。OAuth・QR・manifest に使用。未設定だと起動時に異常終了 |
| `MDM_MOBILECONFIG_PAYLOAD_UUID` | enrollment profile の PayloadUUID (Ruby 版と同じ値を移行) |
| `GOOGLE_ALLOWED_DOMAINS` / `GOOGLE_ALLOWED_USERS` | 管理画面ログイン許可 (カンマ区切り。どちらも空だと誰もログイン不可) |

### プッシュ・登録系 (本番必須・動作確認用には任意)

| 変数 | 説明 |
|---|---|
| `PUSH_CERTIFICATE_BASE64` / `PUSH_CERTIFICATE_PASSWORD` | APNs プッシュ用 .p12。未設定だとプッシュ送信・enrollment profile 生成が失敗 |
| `DEVICE_CERTIFICATE_BASE64` | デバイス認証用 .p12 (base64)。パスワードは `!oreore-mdm` 固定 (Ruby 版と同一) |
| `DEP_KEY_BASE64` | DEP サーバートークン復号用の RSA 秘密鍵 (PEM の base64)。未設定だと DEP アップロード・`/dep/pub_key.pem` が失敗 |

### 推奨

| 変数 | 説明 |
|---|---|
| `SESSION_SECRET` | セッション署名鍵。未設定だと再起動のたびに全セッション無効 (警告ログあり) |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | アップロード保存先。未設定だとローカル `UPLOAD_DIR` (Railway では ephemeral。警告ログあり) |
| `S3_REGION` / `S3_ENDPOINT` | S3 互換ストレージ用 (任意) |

### 任意

| 変数 | 説明 |
|---|---|
| `MDM_API_TOKEN` | `/api/*` の Bearer トークン。未設定だと API は 503 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth。未設定だとデバッグログイン (メール入力のみ) になる |
| `PORT` | Railway が自動注入 (既定 3000) |
| `UPLOAD_DIR` | ローカル保存ディレクトリ (既定 `./uploads`) |

Heroku からの移行は `heroku config:get <KEY> --app oreore-ios-mdm` で取得して設定する。

## 3. デプロイ

```bash
railway up
```

起動コマンド (`bun run start`) が `drizzle-kit migrate` → `bun src/index.ts` の順に
実行するので、初回デプロイ時にテーブルが自動作成される。
マイグレーション差分は `mdm-server/drizzle/` で管理している。

## 4. 動作確認

- `https://<domain>/health` → `{"status":"ok"}`
- `https://<domain>/` → ログイン画面
- ログイン後 `/devices` で QR とデバイス一覧が表示されること

## 注意

- Apple のライブ連携 (APNs/DEP/VPP) は実機・実トークンでの E2E が別途必要
  (単体テストではスタブ化している)。
- DEP トークンのアップロードには `openssl` CLI が必要。
  Railpack イメージに含まれない場合、その操作だけ失敗する
  (起動には影響しない)。
