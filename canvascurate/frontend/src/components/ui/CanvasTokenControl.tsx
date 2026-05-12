"use client";

/**
 * Session Canvas credential control.
 *
 * Shows the stored Canvas PAT status and opens the update dialog used by
 * active Canvas-backed session workspaces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";

import { Alert, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
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

export default function CanvasTokenControl({
  canvasBaseUrl,
  collapsed = false,
}: {
  canvasBaseUrl: string;
  collapsed?: boolean;
}) {
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
        title={collapsed ? `${loading ? "Checking token" : tokenLabel(status)}: ${loading ? canvasBaseUrl : tokenDetail(status)}` : undefined}
        onClick={() => {
          setOpen(true);
          setError(null);
          setSaved(null);
        }}
        className={`flex w-full items-center rounded-xl text-left transition-colors hover:brightness-95 ${tokenClass(status)} ${
          collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5"
        }`}
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white/60">
          <KeyRound size={16} aria-hidden="true" />
        </span>
        <span className={collapsed ? "sr-only" : "min-w-0"}>
          <span className="block truncate text-xs font-bold">{loading ? "Checking token" : tokenLabel(status)}</span>
          <span className="block truncate text-[10px] font-semibold opacity-75">{loading ? canvasBaseUrl : tokenDetail(status)}</span>
        </span>
      </button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Canvas Token"
        subtitle="Credential"
      >
        <ModalBody>
          <p className="text-xs text-on-surface-variant">
            Update the encrypted token used for {canvasBaseUrl}.
          </p>

          <div className={`rounded-xl px-4 py-3 text-sm ${tokenClass(status)}`}>
            <p className="font-bold">{tokenLabel(status)}</p>
            <p className="text-xs opacity-80">{tokenDetail(status)}</p>
          </div>

          <Input
            id="canvas-pat-update"
            label="New Canvas Personal Access Token"
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="Paste a new Canvas PAT"
            className="font-mono"
          />

          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}
          {saved && (
            <Alert variant="success">
              {saved}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={updateToken}
            disabled={saving || !pat.trim()}
            loading={saving}
          >
            Update Token
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
