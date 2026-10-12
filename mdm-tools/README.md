# mdm-tools

リポジトリ直下 `util/*.rb` の Rust 移植。証明書プロビジョニング用のユーティリティ CLI 群。

## 対応表

| Rust バイナリ | 元 Ruby スクリプト | 役割 |
|---|---|---|
| `create-dep-key` | `util/create_dep_key.rb` | DEP 用 RSA 鍵の生成と `DEP_KEY_BASE64` 表示 |
| `create-server-certificates` | `util/create_server_certificates.rb` | server 鍵・自己署名証明書・push 鍵・CSR の生成 |
| `mdm-vendor-sign` | `util/mdm_vendor_sign.rb` | ベンダー証明書で push CSR に署名し `push_signed.req` を作成 |
| `mdmcert-download-request` | `util/mdmcert_download_request.rb` | mdmcert.download への署名リクエスト送信 |
| `mdmcert-download-decrypt` | `util/mdmcert_download_decrypt.rb` | `.b64.p7` を復号して `push_signed.req` を作成 |
| `use-push-certificate` | `util/use_push_certificate.rb` | push 証明書の取り込みとデバイス証明書の発行 |

## 使い方

リポジトリルートで実行する (入出力先は Ruby 版と同じ `./util/`)。

```bash
cargo run -p mdm-tools --bin create-server-certificates
cargo run -p mdm-tools --bin create-dep-key

MDMCERT_DOWNLOAD_API_KEY=... MDMCERT_DOWNLOAD_EMAIL=... \
  cargo run -p mdm-tools --bin mdmcert-download-request
cargo run -p mdm-tools --bin mdmcert-download-decrypt -- <path to .b64.p7>

# またはベンダー証明書がある場合
MDM_VENDOR_CERT_P12_PATH=... MDM_VENDOR_CERT_P12_PASSWORD=... \
  cargo run -p mdm-tools --bin mdm-vendor-sign

PUSH_CERTIFICATE_PASSWORD=... \
  cargo run -p mdm-tools --bin use-push-certificate -- <path to push_certificate.pem>
```

`cargo build -p mdm-tools --release` でビルドしたバイナリは `target/release/` に置かれる。

## テスト

```bash
cargo test -p mdm-tools
```

ロジックは `src/*.rs` のライブラリ関数に切り出し、`src/bin/*.rs` は薄い CLI ラッパーに
してある。単体テストは一時ディレクトリ上で完結し、実際の `util/` には触らない。
`tests/pipeline.rs` は全ツールの通しフロー、`mdmcert` の送信テストは標準ライブラリ
だけのスタブ HTTP サーバーに対して行う。

## 依存クレートの選定

- `openssl`: Ruby の `openssl` と 1:1 に対応するデファクト。X.509 / CSR / PKCS#12 /
  PKCS#7 を自前実装する理由はない。
- `plist`: plist 生成のデファクト。
- `serde_json`: JSON 生成・解析のデファクト。
- `base64`: Base64 のデファクト。Ruby `Base64.encode64` 互換の 60 桁折り返しは
  小さな自前関数 (`base64_encode_wrapped`) で再現している。
- `ureq`: 最小構成の HTTP クライアント。TLS を標準ライブラリだけで実装するのは
  現実的でないため、HTTPS POST に必要な最小限として採用。
- エラー型・16進デコード・CLI 引数処理は標準ライブラリのみ (thiserror 等は不使用)。

## Ruby 版からの意図的な変更

- `mdmcert-download-request`: Ruby 版は成功メッセージの文字列を組み立てたまま
  捨てており、失敗時も exit 0 で沈黙する。Rust 版は成功メッセージを表示し、
  失敗時は非ゼロ終了 + エラーメッセージにした。
- `mdm-vendor-sign`: ベンダー証明書の検証失敗時、Ruby 版と同様に処理は続行するが、
  stderr に警告を出すようにした。
- `push_signed.req` (plist) のバイト列は Ruby の plist gem と完全一致しないことが
  ある。内容 (キーと値) は等価で、Apple へのアップロード用途に差し支えない。
