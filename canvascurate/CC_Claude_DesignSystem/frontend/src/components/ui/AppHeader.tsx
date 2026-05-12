"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type CredentialStatus = {
  has_credential: boolean;
  active?: boolean;
  expires_at?: string;
  days_remaining?: number;
  expired?: boolean;
  warning?: boolean;
  last_validated_at?: string | null;
  validation_status?: "validated" | "missing" | "expired" | "rejected" | "unverified";
  validation_message?: string;
};

function UserAvatar({
  email,
  avatarUrl,
  isSystemAdmin,
}: {
  email: string | null;
  avatarUrl: string | null;
  isSystemAdmin?: boolean;
}) {
  const initials = email ? email[0].toUpperCase() : "?";
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={email ?? "User"}
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full object-cover ring-2 ring-primary/20 ring-offset-2"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary ring-2 ring-primary/20 ring-offset-2">
            {initials}
          </div>
        )}
        <span className="max-w-56 truncate text-sm font-medium text-on-surface-variant">{email}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 shadow-card"
        >
          <div className="px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant">Signed in</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-on-surface">{email}</p>
          </div>
          {isSystemAdmin ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/admin");
              }}
              className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            >
              System diagnostics
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function tokenLabel(status: CredentialStatus | null) {
  if (!status) return "Canvas token";
  if (!status.has_credential) return "Token not active";
  if (!status.active) return "Token not active";
  if (status.warning) return "Token expires soon";
  return "Token active";
}

function tokenDetail(status: CredentialStatus | null) {
  if (!status || !status.has_credential) return "Add a Canvas PAT";
  if (status.validation_status === "rejected") return "Canvas rejected this token";
  if (status.validation_status === "unverified") return "Unable to verify with Canvas";
  if (status.expired || !status.active) return "Update required";
  const days = status.days_remaining ?? 0;
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

function tokenClass(status: CredentialStatus | null) {
  if (status?.has_credential && status.active && !status.expired) {
    return "bg-[#446D12] text-white";
  }
  return "bg-[#ff7f32] text-on-surface";
}

function CanvasTokenControl({ canvasBaseUrl }: { canvasBaseUrl: string }) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const statusUrl = useMemo(() => {
    const params = new URLSearchParams({ canvas_base_url: canvasBaseUrl });
    return `${API_URL}/canvas/credentials/status?${params.toString()}`;
  }, [canvasBaseUrl]);

  const fetchStatus = useCallback(async () => {
    const token = await getAccessToken();
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Canvas token status"));
    return await res.json() as CredentialStatus;
  }, [statusUrl]);

  useEffect(() => {
    let cancelled = false;

    void fetchStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load Canvas token status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  async function updateToken() {
    setError(null);
    setSaved(null);
    setSaving(true);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Canvas-Pat": pat.trim(),
        },
        body: JSON.stringify({ canvas_base_url: canvasBaseUrl }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to update Canvas token"));
      const body = await res.json() as { expires_at: string };
      setPat("");
      setSaved(`Token updated. Curator will request another token by ${new Date(body.expires_at).toLocaleDateString()}.`);
      setStatus(await fetchStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update Canvas token");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setSaved(null);
        }}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:brightness-95 ${tokenClass(status)}`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/60">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 7a4 4 0 1 0 1.2 2.86L21 9V6h-3V3h-3l-1.2 1.2A4 4 0 0 0 15 7Z" />
            <path d="M7 14v3" />
            <path d="M7 20v1" />
          </svg>
        </span>
        <span>
          <span className="block text-xs font-semibold">{loading ? "Checking token" : tokenLabel(status)}</span>
          <span className="block text-[10px] font-medium opacity-75">{loading ? canvasBaseUrl : tokenDetail(status)}</span>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close Canvas token dialog"
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg bg-surface-container-lowest shadow-card ghost-border">
            <div className="border-b border-outline-variant px-6 py-5">
              <h2 className="font-headline text-xl font-bold text-on-surface">Canvas Token</h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Update the encrypted token used for {canvasBaseUrl}.
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className={`rounded-lg px-4 py-3 text-sm ${tokenClass(status)}`}>
                <p className="font-semibold">{tokenLabel(status)}</p>
                <p className="text-xs opacity-80">{tokenDetail(status)}</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-on-surface" htmlFor="canvas-pat-update">
                  New Canvas Personal Access Token
                </label>
                <input
                  id="canvas-pat-update"
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="Paste a new Canvas PAT"
                  className="w-full rounded-lg bg-surface-container-low px-4 py-3 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/50 ghost-border focus:outline-none focus:ring-2 focus:ring-secondary/50"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container">
                  {error}
                </div>
              )}
              {saved && (
                <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">
                  {saved}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-5 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={updateToken}
                  disabled={saving || !pat.trim()}
                  className="btn-primary-gradient rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Validating" : "Update Token"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AppHeader({
  email,
  avatarUrl,
  canvasBaseUrl,
  sessionName,
  isSystemAdmin,
}: {
  email: string | null;
  avatarUrl: string | null;
  canvasBaseUrl?: string | null;
  sessionName?: string | null;
  isSystemAdmin?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 w-full glass border-b border-outline-variant flex items-center justify-between gap-4 px-8 py-3">
      <div className="flex min-w-0 items-center gap-4">
        {sessionName ? (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">Course</p>
            <p className="truncate text-sm font-medium text-on-surface">{sessionName}</p>
          </div>
        ) : null}
        {canvasBaseUrl ? <CanvasTokenControl canvasBaseUrl={canvasBaseUrl} /> : null}
      </div>
      <UserAvatar email={email} avatarUrl={avatarUrl} isSystemAdmin={isSystemAdmin} />
    </header>
  );
}
