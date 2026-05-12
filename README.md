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

**1. `.env` を用意**:

```env
OPENAI_API_KEY=sk-...
# 任意:
# CODEX_EXTRA_ARGS=
```

**2. 起動**:

```bash
docker run --rm -p 3000:3000 \
  --env-file .env \
  -v "$PWD":/workspace \
  -e CODEX_DEFAULT_CWD=/workspace \
  ghcr.io/<owner>/codexweb:latest
```

→ ブラウザで http://localhost:3000

### 起動時に何が走るか

エントリーポイント (`scripts/docker-entrypoint.sh`) が:

1. `OPENAI_API_KEY` が設定されていて `~/.codex/auth.json` が無ければ、
   `codex login --with-api-key` を自動実行 (key を auth.json に焼き込む)
2. `node server.js` を exec

Codex CLI の Responses WebSocket endpoint は `OPENAI_API_KEY` 環境変数だけ
だと認証通らないので、起動時に `auth.json` を作っておく必要があります。

### 既に host で `codex login` 済みの場合

`~/.codex` をそのまま bind-mount すれば、コンテナ内 login をスキップして
ホストの auth/履歴/memories をそのまま使えます:

```bash
docker run --rm -p 3000:3000 \
  --env-file .env \
  -v "$HOME/.codex":/root/.codex \
  -v "$PWD":/workspace \
  -e CODEX_DEFAULT_CWD=/workspace \
  ghcr.io/<owner>/codexweb:latest
```

### その他

- イメージには `@openai/codex` を `npm i -g` で同梱。別バイナリを使いたければ
  マウントして `CODEX_BIN` を上書き
- コンテナは **root で起動するのが既定** (bind mount を traverse するため)。
  非 root で動かしたい場合は `--user <uid>` を付け、ホスト側ディレクトリの
  権限がその UID で参照可能なことを確認

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

## トラブルシュート

### `Codex process error: spawn codex EACCES`

`spawn <bin> EACCES` は Node が **`spawn` 失敗の汎用報告フォーマット** なので、
ファイル自体ではなく `cwd` への chdir 失敗でも同じメッセージが出ます。最も
よくある原因は **bind-mount したホストディレクトリにコンテナ内ユーザーが
traverse できない** ケース。

```bash
# 直る組み合わせ (rootless Podman / Docker)
docker run --rm -p 3000:3000 --user 0 \
  --env-file .env \
  -v "$PWD":/workspace -e CODEX_DEFAULT_CWD=/workspace \
  ghcr.io/<owner>/codexweb:latest
```

最新イメージは既定で root 起動なので `--user 0` は不要 (古いタグを使って
いる場合のみ必要)。

切り分け:

```bash
# コンテナ内で codex の実体と権限を確認
docker run --rm --entrypoint sh ghcr.io/<owner>/codexweb:latest -c '
  set -x;
  command -v codex;
  ls -la "$(command -v codex)";
  readlink -f "$(command -v codex)";
  ls -la "$(readlink -f "$(command -v codex)")";
'
```

対処:

1. **Apple Silicon (M1/M2/M3) の Mac で動かしている場合**
   現在ビルドは `linux/amd64` と `linux/arm64` のマルチアーキ。古いタグを使って
   いると amd64 only の可能性があるので最新を pull:
   ```bash
   docker pull ghcr.io/<owner>/codexweb:latest
   ```
   それでも駄目なら明示的に:
   ```bash
   docker run --platform linux/arm64 ...
   ```

2. **手元の codex バイナリをマウントして使う**
   ```bash
   docker run --rm -p 3000:3000 \
     -e OPENAI_API_KEY=sk-... \
     -e CODEX_BIN=/opt/codex/codex \
     -v /usr/local/bin/codex:/opt/codex/codex:ro \
     ghcr.io/<owner>/codexweb:latest
   ```

3. **イメージ内 codex の同梱をやめて自前で用意**
   ```bash
   docker build --build-arg INSTALL_CODEX=false -t codexweb .
   # 起動時に CODEX_BIN を指定
   ```

### `codex_api::endpoint::responses_websocket: ... 401 Unauthorized`

Codex CLI が `wss://api.openai.com/v1/responses` への接続で 401 を返すのは、
`OPENAI_API_KEY` 環境変数だけだと WebSocket 側の認証経路が成立しないため。
`codex login --with-api-key` で `~/.codex/auth.json` に key を焼き込んでおけば
通ります。

最新イメージは entrypoint がこれを自動で行うので、`OPENAI_API_KEY` を
`.env` 経由で渡せば追加操作は不要です。手動でやる場合:

```bash
docker exec -it <container> sh -c '
  printf "%s\n" "$OPENAI_API_KEY" | codex login --with-api-key
'
```

それでも 401 が続く場合は、key が project-scoped で Responses API への
アクセスが許可されていない / アカウントの tier が足りない可能性。OpenAI
ダッシュボードで該当 project の Model permissions を確認してください。

### `spawn codex ENOENT`

PATH に `codex` がない。`CODEX_BIN` に絶対パスを指定するか、`npm i -g @openai/codex`
等でインストールしてください。

## 既知の制約 (MVP)

- タスクの永続化は **メモリのみ**。プロセス再起動で消えます。
- マルチターン対話は、各ターンで `codex exec` を新規プロセスとして起動する
  シンプル実装です (Codex 側の会話履歴は CLI の挙動に依存)。
- 認証なし — ローカル/個人利用前提です。
- Codex CLI の `--json` 出力スキーマはバージョンにより差異があり、未知の
  イベントは `stdout` として表示されます (`lib/codex-runner.ts` の
  `mapCodexEvent` で必要に応じて拡張可能)。
