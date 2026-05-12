/**
 * API client for Transfer readiness and future Canvas push workflows.
 */

import { createClient } from "@/lib/supabase/client";
import type { TransferJobResponse, TransferMode, TransferReadiness, TransferTargetValidationResponse } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8081";

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : {};
  const detail = typeof body.detail === "string" ? body.detail : fallback;
  return `${detail} (${res.status} ${res.statusText || "HTTP error"}: ${res.url})`;
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

export async function loadTransferReadiness(sessionId: string): Promise<TransferReadiness> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/transfer/readiness`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Transfer readiness"));
  return await res.json() as TransferReadiness;
}

export async function validateTransferTarget(
  sessionId: string,
  canvasUrl: string,
): Promise<TransferTargetValidationResponse> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/transfer/target/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvas_url: canvasUrl }),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to validate target Canvas course"));
  return await res.json() as TransferTargetValidationResponse;
}

export async function startTransferTargetBackup(
  sessionId: string,
  canvasUrl: string,
): Promise<TransferJobResponse> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/transfer/target/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvas_url: canvasUrl }),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to start target course backup"));
  return await res.json() as TransferJobResponse;
}

export async function startTransferJob(
  sessionId: string,
  payload: {
    mode: TransferMode;
    canvas_url?: string;
    erase_first?: boolean;
    target_backup_job_id?: string;
    erase_without_backup_confirmed?: boolean;
  },
): Promise<TransferJobResponse> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/transfer/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to start Transfer job"));
  return await res.json() as TransferJobResponse;
}

export async function loadTransferJob(sessionId: string, jobId: string): Promise<TransferJobResponse> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/transfer/jobs/${jobId}`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Transfer job"));
  return await res.json() as TransferJobResponse;
}
