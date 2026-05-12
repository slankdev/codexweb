import { headers } from "next/headers";
import { getAuthProxyUrl } from "@/lib/auth";

type SearchParams = Promise<{ redirect?: string; error?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { redirect, error } = await searchParams;
  const target = redirect && redirect.startsWith("/") ? redirect : "/";

  // PR previews don't own their own OAuth client — they delegate to a
  // canonical deployment that holds the registered redirect URI. When
  // CODEXWEB_AUTH_PROXY_URL is set, kick the login off there with our
  // own origin as the `?preview=` param so the canonical can bounce a
  // handoff token back to us after Google.
  const proxy = getAuthProxyUrl();
  let loginHref: string;
  if (proxy) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") || "https";
    const host = h.get("x-forwarded-host") || h.get("host") || "";
    const origin = `${proto}://${host}`;
    const params = new URLSearchParams({
      preview: origin,
      redirect: target,
    });
    loginHref = `${proxy}/api/auth/login?${params.toString()}`;
  } else {
    loginHref = `/api/auth/login?redirect=${encodeURIComponent(target)}`;
  }

  return (
    <div className="center-page" style={{ flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 600 }}>Codex Web</div>
      <div style={{ color: "var(--muted)", fontSize: 14 }}>
        Google アカウントでログインしてください
      </div>
      {error && (
        <div style={{ color: "var(--error)", fontSize: 12, maxWidth: 480, textAlign: "center" }}>
          {error}
        </div>
      )}
      <a className="primary login-btn" href={loginHref}>
        <GoogleIcon /> Sign in with Google
      </a>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}
