/**
 * API client for Reports & Downloads read models and lightweight exports.
 */

import { createClient } from "@/lib/supabase/client";
import type { FacultyReviewUploadResult, PrintableCourseContent, ReportDownloadKind, ReportsBackupJob, ReportsOverview } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

const FALLBACK_EXTENSIONS: Record<ReportDownloadKind, string> = {
  content_inventory: "xlsx",
  faculty_review: "xlsx",
  transfer_report: "xlsx",
  health_summary: "xlsx",
  edit_history: "csv",
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

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function loadReportsOverview(sessionId: string): Promise<ReportsOverview> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/overview`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load reports"));
  return await res.json() as ReportsOverview;
}

export async function loadPrintableContent(sessionId: string): Promise<PrintableCourseContent> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/printable-content`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load printable course content"));
  return await res.json() as PrintableCourseContent;
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const encodedMatch = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1]);
  const quotedMatch = disposition?.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const plainMatch = disposition?.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? fallback;
}

export async function downloadReport(sessionId: string, kind: ReportDownloadKind): Promise<{ blob: Blob; filename: string }> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/downloads/${kind}`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to download report"));
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), `${kind}.${FALLBACK_EXTENSIONS[kind]}`);
  return { blob, filename };
}

export async function uploadFacultyReview(sessionId: string, file: File): Promise<FacultyReviewUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/uploads/faculty-review`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to upload Faculty Review workbook"));
  const body = await res.json() as { result: FacultyReviewUploadResult };
  return body.result;
}

export async function startCourseBackup(sessionId: string): Promise<ReportsBackupJob> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/backups/imscc`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to start Canvas backup"));
  const body = await res.json() as { job: ReportsBackupJob };
  return body.job;
}

export async function loadCourseBackupJob(sessionId: string, jobId: string): Promise<ReportsBackupJob> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/reports/backups/imscc/${jobId}`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Canvas backup status"));
  const body = await res.json() as { job: ReportsBackupJob };
  return body.job;
}
