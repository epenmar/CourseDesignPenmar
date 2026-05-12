"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/edplus/Button";
import { createClient } from "@/lib/supabase/client";

type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";

type HealthJob = {
  id: string;
  status: JobStatus;
  result?: {
    health_run_id?: string;
    findings_count?: number;
    items_scanned?: number;
    duration_ms?: number;
  };
  error_message?: string | null;
};

type HealthStatusResponse = {
  job: HealthJob | null;
  health_run: {
    id: string;
    status: JobStatus;
    items_scanned: number;
    duration_ms: number | null;
    summary: Record<string, unknown>;
    created_at: string;
    finished_at: string | null;
  } | null;
};

type HealthRunButtonProps = {
  sessionId: string;
  disabled?: boolean;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

function statusLabel(status: JobStatus) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Scanning";
  if (status === "retrying") return "Retrying";
  if (status === "succeeded") return "Scanned";
  if (status === "cancelled") return "Cancelled";
  return "Failed";
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export default function HealthRunButton({ sessionId, disabled = false }: HealthRunButtonProps) {
  const router = useRouter();
  const pollRef = useRef<number | null>(null);
  const [job, setJob] = useState<HealthJob | null>(null);
  const [latestRun, setLatestRun] = useState<HealthStatusResponse["health_run"]>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = starting || job?.status === "queued" || job?.status === "running" || job?.status === "retrying";

  const getToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/health/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to refresh health status");

    const nextJob = await res.json() as HealthJob;
    setJob(nextJob);

    if (nextJob.status === "succeeded") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      router.refresh();
      return;
    }

    if (nextJob.status === "failed" || nextJob.status === "cancelled") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      setError(nextJob.error_message ?? "Health scan failed");
    }
  }, [getToken, router]);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    void pollJob(jobId).catch((e) => setError(e instanceof Error ? e.message : "Failed to refresh health status"));
    pollRef.current = window.setInterval(() => {
      void pollJob(jobId).catch((e) => setError(e instanceof Error ? e.message : "Failed to refresh health status"));
    }, 1500);
  }, [pollJob]);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestStatus() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/health/sessions/${sessionId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const status = await res.json() as HealthStatusResponse;
        if (cancelled) return;
        setLatestRun(status.health_run);
        if (status.job && ["queued", "running", "retrying"].includes(status.job.status)) {
          setJob(status.job);
          startPolling(status.job.id);
        }
      } catch {
        // The page can still render without live status.
      }
    }

    const timer = window.setTimeout(() => {
      void loadLatestStatus();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [getToken, sessionId, startPolling]);

  async function startScan() {
    setError(null);
    setStarting(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/health/sessions/${sessionId}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to start health scan"));
      }

      const created = await res.json() as { job_id: string; status: JobStatus };
      const nextJob = { id: created.job_id, status: created.status };
      setJob(nextJob);
      startPolling(created.job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start health scan");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch sm:items-end gap-2">
      <Button
        type="button"
        onClick={startScan}
        disabled={disabled || active}
        loading={active}
        icon={<span aria-hidden>♡</span>}
      >
        {active ? statusLabel(job?.status ?? "queued") : latestRun ? "Re-run Health Scan" : "Run Health Scan"}
      </Button>
      {(active || error) && (
        <div className="text-xs text-on-surface-variant text-right min-h-4">
          {error ? <span className="text-error">{error}</span> : <span>Scanning saved course content...</span>}
        </div>
      )}
    </div>
  );
}
