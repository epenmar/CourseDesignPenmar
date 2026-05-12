"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/edplus/Button";
import { createClient } from "@/lib/supabase/client";

type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";

type JobResponse = {
  id: string;
  status: JobStatus;
  result?: {
    fetched_count?: number;
    changed_count?: number;
    duration_ms?: number;
  };
  error_message?: string | null;
};

type SyncStatusResponse = {
  job: JobResponse | null;
  sync_run: {
    status: JobStatus;
    fetched_count: number;
    changed_count: number;
    created_at: string;
    finished_at: string | null;
    error_message: string | null;
  } | null;
};

type SyncCourseButtonProps = {
  sessionId: string;
  variant?: "primary" | "secondary";
  showStatusText?: boolean;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

function statusLabel(status: JobStatus) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Syncing";
  if (status === "retrying") return "Retrying";
  if (status === "succeeded") return "Synced";
  if (status === "cancelled") return "Cancelled";
  return "Failed";
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 && body.detail === "Not Found") {
    return `${fallback}. The configured API (${API_URL}) does not have the latest Canvas sync routes yet. Redeploy or restart the FastAPI backend.`;
  }
  return body.detail ?? fallback;
}

export default function SyncCourseButton({
  sessionId,
  variant = "primary",
  showStatusText = true,
}: SyncCourseButtonProps) {
  const router = useRouter();
  const pollRef = useRef<number | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [latestRun, setLatestRun] = useState<SyncStatusResponse["sync_run"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const active = starting || job?.status === "queued" || job?.status === "running" || job?.status === "retrying";

  const getToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to refresh sync status");

    const nextJob = await res.json() as JobResponse;
    setJob(nextJob);

    if (nextJob.status === "succeeded") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      router.refresh();
      return;
    }
    if (nextJob.status === "failed" || nextJob.status === "cancelled") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      setError(nextJob.error_message ?? "Canvas sync failed");
    }
  }, [getToken, router]);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    void pollJob(jobId).catch((e) => setError(e instanceof Error ? e.message : "Failed to refresh sync status"));
    pollRef.current = window.setInterval(() => {
      void pollJob(jobId).catch((e) => setError(e instanceof Error ? e.message : "Failed to refresh sync status"));
    }, 1500);
  }, [pollJob]);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestStatus() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/sync-status`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const status = await res.json() as SyncStatusResponse;
        if (cancelled) return;
        setLatestRun(status.sync_run);
        if (status.job && ["queued", "running", "retrying"].includes(status.job.status)) {
          setJob(status.job);
          startPolling(status.job.id);
        }
      } catch {
        // The page can still render without live job status.
      }
    }

    void loadLatestStatus();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [getToken, sessionId, startPolling]);

  async function startSync() {
    setError(null);
    setStarting(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sync_kind: latestRun ? "delta" : "full" }),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to start Canvas sync"));
      }

      const created = await res.json() as { job_id: string; status: JobStatus };
      const nextJob = { id: created.job_id, status: created.status };
      setJob(nextJob);
      startPolling(created.job_id);
      router.push(`/sessions/${sessionId}/sync?job=${encodeURIComponent(created.job_id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Canvas sync");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch sm:items-end gap-2">
      <Button
        type="button"
        onClick={startSync}
        disabled={active}
        loading={active}
        variant={variant === "primary" ? "primary" : "ghost"}
        icon={<span aria-hidden>⟳</span>}
      >
        {active ? statusLabel(job?.status ?? "queued") : latestRun ? "Re-sync Canvas" : "Sync Canvas"}
      </Button>
      {(showStatusText && (active || error)) && (
        <div className="text-xs text-on-surface-variant text-right min-h-4">
          {error ? (
            <span className="text-error">{error}</span>
          ) : active ? (
            <span>Pulling Canvas content and saving changes…</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
