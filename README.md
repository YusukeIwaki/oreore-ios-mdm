# oreore-ios-mdm

個人検証用の iOS MDM サーバー。(旧 Ruby + Sinatra 実装から移行済み)

## 構成

3つの独立したコンポーネント (相互に依存なし)。

| ディレクトリ | 内容 | 技術 |
|---|---|---|
| `mdm-server/` | MDM Web サーバー本体 (登録・コマンド・BYOD/ADDE・管理画面・API) | Bun + Hono + drizzle |
| `mdm-tools/` | 証明書・鍵・署名ユーティリティ群 | Rust (std-lib-first) |
| `test-server/` | `.well-known/com.apple.remotemanagement` 配信用テストサーバー | Bun 単体 |

詳細は各ディレクトリの README を参照:

- `mdm-server/README.md` — 使い方・テスト・管理画面
- `mdm-server/RAILWAY.md` — Railway デプロイ手順・環境変数
- `mdm-tools/README.md` — 各ツールの使い方
- `test-server/` — `MDM_SERVER_BASE_URL=... bun src/index.ts` で起動 (既定ポート 4567)

## テスト

```bash
cargo test -p mdm-tools                        # Rust (mdm-tools/ で cargo test でも可)
TEST_DATABASE_URL=postgres://... bun test      # mdm-server/ で実行 (PostgreSQL + floci が必要)
bun test                                       # test-server/ で実行
```

GitHub Actions (`.github/workflows/test.yml`) でも同一内容を実行する。

## デバイスの登録 (Checkin)

デバイスに MDM 構成プロファイルをインストールする。

- `<your domain>` はローカルで可。`https` 必須 (自己署名可)。
- `ngrok http 3000` も利用可。

### via Apple Configurator

Server: oreore-mdm
URL: `https://<your domain>/mdm/appleconfigurator`

### via OTA (Safari)

`https://<your domain>/mdm.mobileconfig` を開く。

### Account-driven Enrollment のテスト

```
MDM_SERVER_BASE_URL=https://<your domain> bun src/index.ts   # test-server/ で実行
```

iOS 17 以降は Device Enrollment (ADDE)、iOS 16 以前は User Enrollment (BYOD) の
構成が配布される。

## Declaration (DDM)

宣言の管理 UI は `https://<your domain>/ddm`。

- `@asset/<name>` は同名アセットの識別子に置換される
- `@public/<name>` は同名パブリックアセットのファイル URL に置換される
- `@configuration/<name>` で構成を参照できる
- 宣言を更新したら `DeclarativeManagement` コマンドで再配布すること

型の一覧は [apple/device-management](https://github.com/apple/device-management/tree/release/declarative/declarations/configurations)、
スキーマは [declarationbase.yaml](https://github.com/apple/device-management/blob/release/declarative/declarations/declarationbase.yaml)・
[公式リファレンス](https://developer.apple.com/documentation/devicemanagement/leveraging_the_declarative_management_data_model_to_scale_devices#3993591) を参照。
