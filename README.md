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
| `AUTH_SECRET` | **必須**。セッション/state Cookie の HMAC 署名鍵 (16 文字以上)。`openssl rand -base64 32` で生成。 |
| `OAUTH_CLIENT_ID` | **必須**。OAuth 2.0 クライアント ID。 |
| `OAUTH_CLIENT_SECRET` | confidential クライアント (Google "Web application" 型など) のみ必要。public クライアントなら省略可。 |
| `OAUTH_AUTHORIZE_URL` / `OAUTH_TOKEN_URL` / `OAUTH_USERINFO_URL` | IdP のエンドポイント。デフォルトは Google。 |
| `OAUTH_SCOPES` | 要求スコープ (デフォルト `openid email profile`)。 |
| `ALLOWED_EMAILS` | ログイン許可リスト。`alice@example.com,@your-company.com` のようにメール or `@` ドメインを並べる。未設定だと **誰でもログイン可能**。 |
| `AUTH_BASE_URL` | OAuth リダイレクト URL を組み立てるベース URL。未設定ならリクエストヘッダから自動推測 (Cloud Run など proxy 経由なら明示推奨)。 |

### 認証 (OAuth 2.0 + PKCE)

Web UI と API ルートは Next.js Middleware で保護されており、未ログインだと
ブラウザは `/login` にリダイレクト、API は `401 Unauthorized` を返します。
フローは **OAuth 2.0 Authorization Code + PKCE (S256)** で常時。
`OAUTH_CLIENT_SECRET` は設定されていれば token endpoint に併送されるので、
public / confidential どちらのクライアントにも対応します。

#### IdP の選び方

| IdP | クライアント種別 | `OAUTH_CLIENT_SECRET` | メモ |
| --- | --- | --- | --- |
| Google "Web application" | confidential | 必須 | Cloud Run など HTTPS ホスティング向け。 |
| Google "Desktop app" | public | 不要 | ローカル限定 (redirect URI が loopback)。 |
| Auth0 / Keycloak / Okta / Cognito (Native/SPA) | public | 不要 | 任意 HTTPS redirect 可。 |
| Auth0 / Keycloak (Regular Web App) | confidential | 必須 | 同上。 |

#### Google "Web application" でのセットアップ

1. [Google Cloud Console](https://console.cloud.google.com/) で OAuth 2.0
   クライアント ID を作成 (Application type: **Web application**)。
2. Authorized redirect URIs に下記を追加:
   - `http://localhost:3000/api/auth/callback` (開発用)
   - `https://<cloud-run-host>/api/auth/callback` (本番用)
3. `.env.local` または Secret Manager / GitHub Variables 経由で設定:
   ```env
   OAUTH_CLIENT_ID=<client id>
   OAUTH_CLIENT_SECRET=<client secret>
   AUTH_SECRET=$(openssl rand -base64 32)
   ALLOWED_EMAILS=you@example.com
   ```

#### 他の IdP の例 (Keycloak public client)

```env
OAUTH_CLIENT_ID=codexweb
# OAUTH_CLIENT_SECRET は省略 (Keycloak で public client にする)
OAUTH_AUTHORIZE_URL=https://kc.example.com/realms/main/protocol/openid-connect/auth
OAUTH_TOKEN_URL=https://kc.example.com/realms/main/protocol/openid-connect/token
OAUTH_USERINFO_URL=https://kc.example.com/realms/main/protocol/openid-connect/userinfo
```

#### 提供エンドポイント

| Method | Path | 説明 |
| --- | --- | --- |
| GET | `/api/auth/login` | IdP の同意画面へリダイレクト (`?redirect=/path` 対応) |
| GET | `/api/auth/callback` | IdP からのコールバック (内部用) |
| GET/POST | `/api/auth/logout` | セッション Cookie を破棄 |
| GET | `/api/auth/me` | 現在ログイン中のユーザ情報 (未ログインなら `{ user: null }`) |

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

### Cloud Run

`main` への push で `.github/workflows/cloudrun.yml` が起動し、Artifact
Registry にイメージを push したあと Cloud Run にデプロイします。
**シングルインスタンス前提** で動作するよう設定済み (`min-instances=1`,
`max-instances=1`, `--timeout=3600`) で、これはタスクストアが
インメモリ実装である現状の制約に合わせたものです。

#### 前提セットアップ (Google Cloud 側、一度だけ)

```bash
# 変数
PROJECT_ID=your-project
REGION=asia-northeast1
REPO=codexweb            # Artifact Registry repo 名
SERVICE=codexweb         # Cloud Run service 名

# API 有効化
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

# Artifact Registry リポジトリ
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --project="$PROJECT_ID"

# デプロイ用 Service Account
SA=codexweb-deployer
gcloud iam service-accounts create "$SA" --project="$PROJECT_ID"
SA_EMAIL="$SA@$PROJECT_ID.iam.gserviceaccount.com"
for role in roles/run.admin roles/artifactregistry.writer \
            roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$role"
done

# Workload Identity Federation (GitHub → GCP の keyless 認証)
gcloud iam workload-identity-pools create github \
  --location=global --project="$PROJECT_ID"
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition='assertion.repository=="<OWNER>/codexweb"' \
  --project="$PROJECT_ID"
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/github/attribute.repository/<OWNER>/codexweb"

# Secret Manager にシークレット投入 (Google Web app 型を使う想定)
printf "%s" "$(openssl rand -base64 32)" | gcloud secrets create AUTH_SECRET --data-file=- --project="$PROJECT_ID"
printf "%s" "<your-oauth-client-id>"     | gcloud secrets create OAUTH_CLIENT_ID --data-file=- --project="$PROJECT_ID"
printf "%s" "<your-oauth-client-secret>" | gcloud secrets create OAUTH_CLIENT_SECRET --data-file=- --project="$PROJECT_ID"
printf "%s" "sk-..."                     | gcloud secrets create OPENAI_API_KEY --data-file=- --project="$PROJECT_ID"
```

> **public client を使う場合**: `OAUTH_CLIENT_SECRET` シークレットを作らず、
> リポジトリ Variables で `OAUTH_USE_CLIENT_SECRET=false` をセットすると
> workflow が secret 取得をスキップします。

#### GitHub 側の設定

リポジトリ Settings → Secrets and variables → Actions → **Variables** タブで:

| Variable | 例 |
| --- | --- |
| `GCP_PROJECT_ID` | `your-project` |
| `GCP_REGION` | `asia-northeast1` |
| `ARTIFACT_REGISTRY_REPO` | `codexweb` |
| `CLOUD_RUN_SERVICE` | `codexweb` |
| `WIF_PROVIDER` | `projects/<NUM>/locations/global/workloadIdentityPools/github/providers/github` |
| `WIF_SERVICE_ACCOUNT` | `codexweb-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |
| `ALLOWED_EMAILS` | (推奨) 許可メール/ドメイン |
| `AUTH_BASE_URL` | (推奨) `https://<service>-<hash>-<region>.a.run.app` |
| `CODEX_DEFAULT_CWD` | (任意) 例 `/tmp` |

初回デプロイで URL が確定するので、その URL を Google Cloud Console の
OAuth クライアントの "Authorized redirect URIs" にも追加してください
(`<URL>/api/auth/callback`)。あわせて `AUTH_BASE_URL` を変数にセットして
2 回目以降のデプロイで使うのが確実です。

#### 制約メモ

- タスクは **インメモリ** 保持なので、リビジョン入れ替え (新規デプロイ)
  で進行中タスクは失われます。本番運用するなら Firestore 等への永続化が
  必要 (現状未対応)。
- `--timeout=3600` を指定しているので Cloud Run としては 60 分まで SSE が
  維持されます。それ以上のタスクは途中で切れるので、ローカル/専用 VM での
  運用を推奨。

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
- 認証は Google OAuth のみサポート (`ALLOWED_EMAILS` でアカウント制限可)。
- Codex CLI の `--json` 出力スキーマはバージョンにより差異があり、未知の
  イベントは `stdout` として表示されます (`lib/codex-runner.ts` の
  `mapCodexEvent` で必要に応じて拡張可能)。
