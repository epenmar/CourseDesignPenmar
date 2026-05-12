"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Badge, Button, Card, CardBody, CardSkeleton, DataTable, StatusBadge } from "@/components/edplus";
import type { DataTableColumn } from "@/components/edplus";
import { loadQueueDiagnostics, retryQueueJob } from "../api/adminClient";
import type { QueueDiagnosticsJob, QueueDiagnosticsJobType, QueueDiagnosticsResponse } from "../types";

function formatDate(value?: string | null) {
  if (!value) return "Not started";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(seconds?: number | null) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under 1 minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes
      ? `${hours}h ${remainingMinutes}m`
      : `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days} day${days === 1 ? "" : "s"}`;
}

function statusCount(data: QueueDiagnosticsResponse | null, status: string) {
  return data?.summary.by_status[status] ?? 0;
}

function payloadLabel(payload?: Record<string, unknown>) {
  if (!payload) return "";
  const filename = typeof payload.filename === "string" ? payload.filename : "";
  const documentId = typeof payload.document_id === "string" ? payload.document_id : "";
  const contentItemId = typeof payload.content_item_id === "string" ? payload.content_item_id : "";
  return filename || documentId || contentItemId || "";
}

function groupLabel(value?: string | null) {
  if (!value) return "Other";
  if (value === "course_creation") return "Course Creation";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function warningClass(level?: string | null) {
  if (level === "critical") return "border-error/40 bg-error-container/70 text-error";
  if (level === "warning") return "border-tertiary/40 bg-tertiary-container/45 text-on-tertiary-container";
  if (level === "info") return "border-primary/30 bg-primary/10 text-primary";
  return "border-outline-variant/50 bg-surface-container-low text-on-surface-variant";
}

function healthTitle(level?: string | null) {
  if (level === "critical") return "Queue attention required";
  if (level === "warning") return "Queue backlog building";
  if (level === "info") return "Queue has active work";
  return "Queue healthy";
}

function statusVariant(status?: string | null) {
  if (status === "failed" || status === "canceled") return "error";
  if (status === "queued" || status === "retrying" || status === "running") return "pending";
  if (status === "succeeded") return "success";
  return "neutral";
}

type JobTypeRow = QueueDiagnosticsJobType & { id: string };

export default function AdminDiagnosticsWorkspace() {
  const [data, setData] = useState<QueueDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      setData(await loadQueueDiagnostics());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue diagnostics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const retryJob = useCallback(async (jobId: string) => {
    setRetryingJobId(jobId);
    setError(null);
    try {
      await retryQueueJob(jobId);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry queue job");
    } finally {
      setRetryingJobId(null);
    }
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeJobTypes = useMemo(
    () => (data?.job_types ?? []).filter((row) => row.queued + row.retrying + row.running > 0),
    [data],
  );
  const jobTypeRows = useMemo<JobTypeRow[]>(
    () => (activeJobTypes.length ? activeJobTypes : data?.job_types.slice(0, 8) ?? []).map((row) => ({
      ...row,
      id: row.job_type,
    })),
    [activeJobTypes, data?.job_types],
  );
  const jobTypeColumns = useMemo<DataTableColumn<JobTypeRow>[]>(() => [
    {
      key: "job_type",
      label: "Job Type",
      widthPct: 26,
      render: (row) => <span className="font-semibold text-on-surface">{row.job_type}</span>,
    },
    {
      key: "group",
      label: "Pool",
      widthPct: 18,
      render: (row) => <span className="text-on-surface-variant">{groupLabel(row.group)}</span>,
    },
    { key: "queued", label: "Queued", widthPct: 10, render: (row) => row.queued },
    { key: "retrying", label: "Retrying", widthPct: 10, render: (row) => row.retrying },
    { key: "running", label: "Running", widthPct: 10, render: (row) => row.running },
    { key: "failed", label: "Failed", widthPct: 10, render: (row) => row.failed },
    {
      key: "latest_queued_at",
      label: "Latest",
      widthPct: 16,
      render: (row) => <span className="text-on-surface-variant">{formatDate(row.latest_queued_at)}</span>,
    },
  ], []);
  const recentJobColumns = useMemo<DataTableColumn<QueueDiagnosticsJob>[]>(() => [
    {
      key: "status",
      label: "Status",
      widthPct: 12,
      render: (job) => (
        <StatusBadge
          status={job.status}
          variant={statusVariant(job.status)}
          label={job.status.replaceAll("_", " ")}
        />
      ),
    },
    {
      key: "job_type",
      label: "Job",
      widthPct: 17,
      render: (job) => <span className="font-semibold text-on-surface">{job.job_type}</span>,
    },
    {
      key: "group",
      label: "Pool",
      widthPct: 12,
      render: (job) => <span className="text-on-surface-variant">{groupLabel(job.group)}</span>,
    },
    {
      key: "user",
      label: "User",
      widthPct: 16,
      render: (job) => <span className="text-on-surface-variant">{job.user_email || job.user_id || "Unknown"}</span>,
    },
    {
      key: "session",
      label: "Session",
      widthPct: 15,
      render: (job) => <span className="text-on-surface-variant">{job.session_name || job.session_id || "None"}</span>,
    },
    {
      key: "reference",
      label: "Reference",
      widthPct: 14,
      render: (job) => <span className="text-on-surface-variant">{payloadLabel(job.payload) || "None"}</span>,
    },
    {
      key: "queued_at",
      label: "Queued",
      widthPct: 14,
      render: (job) => <span className="text-on-surface-variant">{formatDate(job.queued_at)}</span>,
    },
    {
      key: "error",
      label: "Error",
      widthPct: 20,
      render: (job) => (
        <div className="space-y-2">
          {job.error_message ? <span className="line-clamp-3 text-error">{job.error_message}</span> : <span className="text-on-surface-variant">None</span>}
          {job.status === "failed" || job.status === "canceled" ? (
            <Button
              type="button"
              onClick={() => void retryJob(job.id)}
              disabled={retryingJobId === job.id}
              loading={retryingJobId === job.id}
              icon={<RefreshCw size={12} />}
              size="sm"
              className="h-auto px-2.5 py-1.5 text-xs"
            >
              Retry
            </Button>
          ) : null}
        </div>
      ),
    },
  ], [retryJob, retryingJobId]);

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">System Admin</p>
          <h1 className="mt-1 font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            Queue Diagnostics
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Review recent background jobs across users and sessions. This page is read-only and is intended for diagnosing queue backlog, failed jobs, and worker routing.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          loading={refreshing}
          icon={<RefreshCw size={16} />}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="error">{error}</Alert>
      ) : null}

      {loading ? (
        <CardSkeleton lines={6} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["Active", data?.summary.active_total ?? 0],
              ["Queued", statusCount(data, "queued")],
              ["Retrying", statusCount(data, "retrying")],
              ["Running", statusCount(data, "running")],
              ["Failed", statusCount(data, "failed")],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardBody className="px-4 py-3">
                <p className="text-sm font-semibold text-on-surface-variant">{label}</p>
                <p className="mt-2 font-headline text-3xl font-extrabold text-on-surface">{value}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card className={`px-5 py-4 ${warningClass(data?.summary.health?.warning_level)}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold">{healthTitle(data?.summary.health?.warning_level)}</p>
                <p className="mt-1 text-sm opacity-85">
                  {data?.summary.health?.message || "No active worker pool backlog in the sampled jobs."}
                </p>
              </div>
              {data?.summary.health?.worst_group ? (
                <Badge className="w-fit bg-white/50">
                  Focus: {groupLabel(data.summary.health.worst_group)}
                </Badge>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardBody>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">Worker Pools</h2>
                <p className="text-sm text-on-surface-variant">
                  Grouped by the recommended Railway worker split so backlogs can be traced to PDF, AI, Canvas, transfer, or report capacity.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {(data?.job_groups ?? []).map((group) => (
                <Card key={group.group} className={`px-4 py-3 ${warningClass(group.warning_level)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{groupLabel(group.group)}</p>
                      <p className="mt-1 text-xs opacity-80">
                        {group.warning_message || "No active backlog in this pool."}
                      </p>
                    </div>
                    <Badge className="bg-white/50 px-2 py-1 text-xs">
                      {group.active_total} active
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="font-bold">{group.queued}</p>
                      <p className="opacity-75">Queued</p>
                    </div>
                    <div>
                      <p className="font-bold">{group.retrying}</p>
                      <p className="opacity-75">Retrying</p>
                    </div>
                    <div>
                      <p className="font-bold">{group.running}</p>
                      <p className="opacity-75">Running</p>
                    </div>
                    <div>
                      <p className="font-bold">{group.failed}</p>
                      <p className="opacity-75">Failed</p>
                    </div>
                  </div>
                  {group.oldest_active_queued_at ? (
                    <p className="mt-3 text-xs opacity-75">{(() => {
                      const ageLabel = formatDuration(group.oldest_active_age_seconds);
                      return `Oldest active: ${formatDate(group.oldest_active_queued_at)}${ageLabel ? ` (${ageLabel})` : ""}`;
                    })()}</p>
                  ) : null}
                </Card>
              ))}
            </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">Active Job Types</h2>
                <p className="text-sm text-on-surface-variant">
                  Showing job types with queued, retrying, or running work in the latest {data?.summary.sampled_jobs ?? 0} jobs.
                </p>
              </div>
            </div>
            <DataTable
              className="mt-4"
              columns={jobTypeColumns}
              data={jobTypeRows}
              emptyTitle="No job types"
              emptyDescription="No queue job types were returned in the latest sample."
            />
            </CardBody>
          </Card>

          <Card>
            <CardBody>
            <h2 className="font-headline text-xl font-bold text-on-surface">Recent Jobs</h2>
            <DataTable
              className="mt-4"
              columns={recentJobColumns}
              data={data?.recent_jobs ?? []}
              emptyIcon={<RefreshCw size={18} />}
              emptyTitle="No recent jobs"
              emptyDescription="No queue jobs were returned in the latest diagnostics sample."
            />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
