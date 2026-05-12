"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";

type JobResponse = {
  id: string;
  status: JobStatus;
  result?: {
    stage?: string;
    message?: string;
    progress?: number;
    fetched_count?: number;
    changed_count?: number;
    duration_ms?: number;
  };
  error_message?: string | null;
  queued_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

type SyncStatusResponse = {
  job: JobResponse | null;
  sync_run: {
    status: JobStatus;
    fetched_count: number;
    changed_count: number;
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  } | null;
};

const STEPS = [
  { key: "connect", label: "Connecting to Canvas", detail: "Validating credentials and course access" },
  { key: "modules", label: "Fetching modules", detail: "Reading module structure and placements" },
  { key: "content", label: "Fetching content", detail: "Pulling pages, assignments, discussions, quizzes, and files" },
  { key: "persist", label: "Saving inventory", detail: "Writing metadata and body content to Supabase" },
] as const;

function statusCopy(status?: JobStatus) {
  if (status === "succeeded") return "Pull Complete";
  if (status === "failed") return "Pull Failed";
  if (status === "cancelled") return "Pull Cancelled";
  if (status === "queued") return "Queued for Pull";
  return "Synchronizing Assets";
}

function progressFor(status?: JobStatus) {
  if (status === "succeeded") return 100;
  if (status === "failed" || status === "cancelled") return 100;
  if (status === "running") return 68;
  if (status === "retrying") return 52;
  return 18;
}

function stageIndex(stage?: string) {
  if (stage === "queued") return 0;
  if (stage === "connecting") return 0;
  if (stage === "modules") return 1;
  if (stage === "content" || stage === "references") return 2;
  if (stage === "saving" || stage === "images" || stage === "completed") return 3;
  return 0;
}

function inferredRunningStatus(job: JobResponse | null, syncRun: SyncStatusResponse["sync_run"]) {
  if (job?.status && job.status !== "queued") {
    return job.status;
  }

  const stage = job?.result?.stage;
  if (job?.started_at || (stage && stage !== "queued")) {
    return "running" as const;
  }

  if (syncRun?.status === "running") {
    return "running" as const;
  }

  return job?.status ?? syncRun?.status;
}

function stepState(index: number, status?: JobStatus, stage?: string) {
  if (status === "succeeded") return "complete";
  if (status === "failed" || status === "cancelled") return index < 2 ? "complete" : "failed";
  if (status === "running") {
    const activeIndex = stageIndex(stage);
    if (index < activeIndex) return "complete";
    return index === activeIndex ? "active" : "pending";
  }
  if (status === "retrying") return index < 1 ? "complete" : index === 1 ? "active" : "pending";
  return index === 0 ? "active" : "pending";
}

function formatDuration(durationMs?: number) {
  if (!durationMs) return "Not available yet";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes} min ${remaining} sec`;
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 && body.detail === "Not Found") {
    return `${fallback}. The configured API (${API_URL}) does not have the latest Canvas sync routes yet. Redeploy or restart the FastAPI backend.`;
  }
  return body.detail ?? fallback;
}

export default function SyncProgressPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sessionId = params.id;
  const requestedJobId = searchParams.get("job");
  const shouldStart = searchParams.get("start") === "1";
  const pollRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const redirectedRef = useRef(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [syncRun, setSyncRun] = useState<SyncStatusResponse["sync_run"]>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStatus = inferredRunningStatus(job, syncRun);
  const isTerminal = currentStatus === "succeeded" || currentStatus === "failed" || currentStatus === "cancelled";
  const pendingStart = shouldStart && !requestedJobId && !job && !error;
  const active = pendingStart || currentStatus === "queued" || currentStatus === "running" || currentStatus === "retrying";
  const progress = job?.result?.progress ?? progressFor(currentStatus);
  const fetchedCount = job?.result?.fetched_count ?? syncRun?.fetched_count ?? 0;
  const changedCount = job?.result?.changed_count ?? syncRun?.changed_count ?? 0;
  const currentMessage = job?.result?.message ?? (pendingStart ? "Starting Canvas pull" : "Waiting for sync status");
  const durationMs = job?.result?.duration_ms;

  const loadStatus = useCallback(async (jobId?: string | null) => {
    const token = await getAccessToken();
    const endpoint = jobId
      ? `${API_URL}/canvas/jobs/${jobId}`
      : `${API_URL}/canvas/sessions/${sessionId}/sync-status`;
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(await parseApiError(res, "Failed to load pull status"));
    }

    if (jobId) {
      setJob(await res.json() as JobResponse);
      return;
    }

    const body = await res.json() as SyncStatusResponse;
    setJob(body.job);
    setSyncRun(body.sync_run);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        await loadStatus(requestedJobId);
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load pull status");
      }
    }

    void tick();
    pollRef.current = window.setInterval(() => {
      void tick();
    }, 1500);

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadStatus, requestedJobId]);

  useEffect(() => {
    if (!shouldStart || requestedJobId || startedRef.current) return;
    startedRef.current = true;

    async function startPull() {
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/pull`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sync_kind: "full" }),
        });

        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to start Canvas pull"));
        }

        const created = await res.json() as { job_id: string; status: JobStatus };
        setJob({ id: created.job_id, status: created.status });
        router.replace(`/sessions/${sessionId}/sync?job=${encodeURIComponent(created.job_id)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start Canvas pull");
      }
    }

    void startPull();
  }, [requestedJobId, router, sessionId, shouldStart]);

  useEffect(() => {
    if (isTerminal && pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
      router.refresh();
    }
  }, [isTerminal, router]);

  useEffect(() => {
    if (currentStatus !== "succeeded" || redirectedRef.current) return;
    redirectedRef.current = true;
    const timeout = window.setTimeout(() => {
      router.replace(`/sessions/${sessionId}/health`);
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [currentStatus, router, sessionId]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <nav className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
          <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
          <span>›</span>
          <Link href={`/sessions/${sessionId}/health`} className="hover:text-primary transition-colors">Course Health</Link>
          <span>›</span>
          <span className="text-primary">Content Pull</span>
        </nav>
        <h1 className="font-headline font-extrabold text-on-surface text-4xl tracking-tight">
          {statusCopy(currentStatus)}
        </h1>
        <p className="text-sm text-on-surface-variant mt-2">
          Pulling Canvas course content into the Curator repository. You will be taken to Course Health when the pull finishes.
        </p>
      </header>

      <section className="bg-surface-container-lowest rounded-xl p-8 shadow-sm ghost-border relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 text-primary/10 text-8xl">⟳</div>
        <div className="relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="font-headline font-bold text-primary text-xl mb-1">
                Canvas Course Sync
              </h2>
              <p className="text-sm text-on-surface-variant font-medium">
                Job {job?.id ?? requestedJobId ?? (shouldStart ? "starting" : "pending")}
              </p>
            </div>
            <div className="md:text-right">
              <span className="text-3xl font-headline font-extrabold text-secondary">{progress}%</span>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                {pendingStart ? "Starting" : active ? "In progress" : currentStatus ?? "Loading"}
              </p>
            </div>
          </div>

          <div className="w-full h-3 bg-surface-container rounded-full overflow-hidden mb-10">
            <div
              className="h-full bg-secondary-container transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>

          {error && (
            <div className="bg-error-container text-on-error-container text-sm rounded-xl px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {STEPS.map((step, index) => {
              const state = stepState(index, currentStatus, job?.result?.stage);
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-4 p-4 rounded-lg border ${
                    state === "complete"
                      ? "bg-surface-container-low border-transparent"
                      : state === "active"
                        ? "bg-secondary-container/10 border-secondary-container"
                        : state === "failed"
                          ? "bg-error-container border-error"
                          : "bg-surface border-dashed border-outline-variant/30"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    state === "complete"
                      ? "bg-primary text-on-primary"
                      : state === "active"
                        ? "bg-secondary-container text-on-secondary-container animate-pulse"
                        : state === "failed"
                          ? "bg-error text-on-error"
                          : "bg-surface-container text-on-surface-variant"
                  }`}>
                    {state === "complete" ? "✓" : state === "failed" ? "!" : state === "active" ? "…" : "•"}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-on-surface">{step.label}</p>
                    <p className="text-[11px] text-on-surface-variant">{step.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <section className="bg-surface-container-lowest rounded-xl p-6 ghost-border">
          <h2 className="text-sm font-bold text-primary uppercase tracking-wide mb-4">Current Status</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Phase</p>
              <p className="mt-1 text-sm font-bold text-on-surface">{currentMessage}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Fetched</p>
              <p className="mt-1 text-2xl font-headline font-extrabold text-primary">{fetchedCount}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Changed</p>
              <p className="mt-1 text-2xl font-headline font-extrabold text-primary">{changedCount}</p>
            </div>
          </div>
        </section>

        <aside className="bg-primary p-6 rounded-xl text-on-primary flex flex-col justify-between shadow-lg">
          <div>
            <div className="text-3xl mb-4">✦</div>
            <h3 className="text-sm font-bold mb-2">Pull Summary</h3>
            <p className="text-xs leading-relaxed opacity-90">
              {active
                ? "Final counts are shown as Canvas records are saved."
                : `${fetchedCount} records fetched. ${changedCount} records changed since the previous sync.`}
            </p>
            <p className="mt-3 text-xs leading-relaxed opacity-80">
              Duration: {formatDuration(durationMs)}
            </p>
          </div>
          <div className="mt-6 space-y-2">
            <Link
              href={`/sessions/${sessionId}/inventory`}
              className={`block w-full py-2 bg-white/15 hover:bg-white/20 text-xs font-bold rounded-lg border border-white/20 transition-colors text-center ${active ? "pointer-events-none opacity-60" : ""}`}
            >
              View Inventory
            </Link>
            <Link
              href={`/sessions/${sessionId}/health`}
              className="block w-full py-2 bg-white/10 hover:bg-white/20 text-xs font-bold rounded-lg border border-white/15 transition-colors text-center"
            >
              Course Health
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
