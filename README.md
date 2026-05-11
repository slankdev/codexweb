# codexweb

OpenAI Codex CLI ([`openai/codex`](https://github.com/openai/codex)) を Web UI から
触れるようにする、Next.js ベースの薄いラッパーです。Codex Web や Claude Code
Cloud のような **チャット形式の Web UI** で Codex エージェントにタスクを投げ、
ストリーミング結果を眺めたり、追加の指示を送ったりできます。

## 仕組み

```
┌──────────┐    SSE     ┌────────────────┐  spawn   ┌──────────────┐
│  Browser │ ◀────────  │ Next.js server │ ──────▶  │  codex exec  │
│  (chat)  │    HTTP    │  (API routes)  │   pipe   │ (vendor/codex│
└──────────┘            └────────────────┘          └──────────────┘
```

- Next.js App Router の API ルートで `codex exec --json` を `child_process.spawn`
- 各行を JSON としてパースし、`assistant_message` / `tool_call` / `tool_result`
  などの内部イベント型に変換
- ブラウザは `EventSource` で per-task の SSE エンドポイントを購読し、チャット
  風に描画

## セットアップ

依存ツール: Node.js 18.18+ と git。

```bash
# 1. 依存パッケージ
npm install

# 2. openai/codex を vendor/codex にサブモジュールとして追加
npm run setup:codex
# (or: bash scripts/setup-codex.sh)

# 3. codex CLI のビルド/インストール
#    openai/codex の README に従ってください。例:
#      cd vendor/codex/codex-cli && npm install && npm run build
#    あるいはグローバルインストール:
#      npm i -g @openai/codex
#    どこにバイナリがあるかに応じて CODEX_BIN を設定 (下記)。

# 4. 環境変数
cp .env.example .env.local
# OPENAI_API_KEY と必要なら CODEX_BIN を設定

# 5. 起動
npm run dev
# → http://localhost:3000
```

### 環境変数

| 変数 | 説明 |
| --- | --- |
| `CODEX_BIN` | spawn する codex バイナリへの絶対パス。未指定なら `vendor/codex/codex-cli/bin/codex.js` → `codex` (PATH) の順で解決。 |
| `CODEX_DEFAULT_CWD` | 「新しいタスク」ダイアログでデフォルトに入れる作業ディレクトリ。 |
| `OPENAI_API_KEY` | Codex CLI が呼び出すモデルの認証用 (詳細は upstream の README 参照)。 |

## 使い方

1. 右上の **+ New** から新しいタスクを作成
2. プロンプトと作業ディレクトリ (絶対パス) を入力して **実行**
3. 左サイドバーにタスクが追加され、メイン領域に Codex の出力がチャット形式で
   ストリーミング表示される
4. 完了後、下部のフォームから追加の指示を送れます

## API (内部)

| Method | Path | 説明 |
| --- | --- | --- |
| GET | `/api/tasks` | タスク一覧 |
| POST | `/api/tasks` | 新規タスク作成 (`prompt`, `cwd`, `model?`) |
| GET | `/api/tasks/:id` | タスク詳細 (これまでのイベント全部) |
| GET | `/api/tasks/:id/events` | SSE ストリーム |
| POST | `/api/tasks/:id/messages` | 追加メッセージ (アイドル時のみ) |
| POST | `/api/tasks/:id/stop` | 実行中のタスクを停止 |

## デプロイ

### コンテナ (推奨)

`main` への push で GitHub Actions が `ghcr.io/<owner>/codexweb` にイメージを
build & push します (`.github/workflows/docker.yml`)。タグ: `latest`、ブランチ名、
コミット SHA、`v*` の git tag。

```bash
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY=sk-... \
  -v /path/to/your/projects:/workspace \
  -e CODEX_DEFAULT_CWD=/workspace \
  ghcr.io/<owner>/codexweb:latest
```

イメージには `@openai/codex` を `npm i -g` で同梱しています。別バイナリを使い
たい場合はマウントして `CODEX_BIN` を上書きしてください。

ビルド時に codex CLI の同梱を抑止する:

```bash
docker build --build-arg INSTALL_CODEX=false -t codexweb .
```

### Vercel

1. Vercel ダッシュボードで GitHub リポジトリを連携 (`Add New > Project`)
2. Framework Preset は自動検出される `Next.js` のままで OK
3. Environment Variables に `OPENAI_API_KEY` を設定
4. `main` への push で自動デプロイ

**⚠️ 制限**: Vercel の serverless runtime ではこのアプリの中核機能は動きません。
`codex` バイナリが存在しないこと、SSE が関数タイムアウト (Hobby 60秒 / Pro 300秒)
で切れること、メモリ内タスク state が関数インスタンス間で共有されないことが
主な理由です。**UI とビルドの動作確認用** と割り切ってください。
実利用にはコンテナデプロイを推奨します。

## 既知の制約 (MVP)

- タスクの永続化は **メモリのみ**。プロセス再起動で消えます。
- マルチターン対話は、各ターンで `codex exec` を新規プロセスとして起動する
  シンプル実装です (Codex 側の会話履歴は CLI の挙動に依存)。
- 認証なし — ローカル/個人利用前提です。
- Codex CLI の `--json` 出力スキーマはバージョンにより差異があり、未知の
  イベントは `stdout` として表示されます (`lib/codex-runner.ts` の
  `mapCodexEvent` で必要に応じて拡張可能)。
