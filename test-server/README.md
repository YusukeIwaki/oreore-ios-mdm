# test-server

`testaccount.rb` の Bun 移植。Account-driven Enrollment の検証用に
`/.well-known/com.apple.remotemanagement` だけを返す最小サーバー。
ルートが1つだけなので Hono は使わず `Bun.serve` のみで構成している。

## 使い方

```bash
MDM_SERVER_BASE_URL=https://<your-mdm-server> bun src/index.ts
```

ポートは Sinatra 版と同じ 4567 が既定。`PORT` 環境変数で変更できる。

## テスト

```bash
bun test        # 単体テスト
bun run typecheck
```
