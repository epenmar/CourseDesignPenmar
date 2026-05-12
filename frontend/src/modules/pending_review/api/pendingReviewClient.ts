/**
 * API client for the session-level Pending Review workflow.
 *
 * Public endpoint paths remain under `/canvas` until the backend router split
 * moves them into a dedicated Pending Review API module.
 */

import { createClient } from "@/lib/supabase/client";

import type {
  PendingChangesResponse,
  PendingDiffResponse,
  PushHistoryItem,
  ModuleApplyHistoryItem,
} from "@/modules/pending_review/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

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

async function fetchJson<T>(path: string, fallback: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseApiError(res, fallback));
  return await res.json() as T;
}

async function sendJson<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) throw new Error(await parseApiError(res, fallback));
  return await res.json() as T;
}

export function listPendingChanges(sessionId: string) {
  return fetchJson<PendingChangesResponse>(
    `/canvas/sessions/${sessionId}/pending-changes`,
    "Failed to load pending changes",
  );
}

export function getPendingDiff(sessionId: string, contentItemId: string) {
  return fetchJson<PendingDiffResponse>(
    `/canvas/sessions/${sessionId}/content/${contentItemId}/pending-diff`,
    "Failed to load pending diff",
  );
}

export function listPushHistory(sessionId: string, limit = 8) {
  return fetchJson<{ items: PushHistoryItem[] }>(
    `/canvas/sessions/${sessionId}/push-history?limit=${limit}`,
    "Failed to load push history",
  );
}

export function listModuleApplyHistory(sessionId: string, limit = 8) {
  return fetchJson<{ items: ModuleApplyHistoryItem[] }>(
    `/canvas/sessions/${sessionId}/module-apply-history?limit=${limit}`,
    "Failed to load module update history",
  );
}

export function pushContentChange(sessionId: string, contentItemId: string, batchId: string) {
  return sendJson<{ title?: string; html_body?: string }>(
    `/canvas/sessions/${sessionId}/content/${contentItemId}/push`,
    {
      method: "POST",
      body: JSON.stringify({ batch_id: batchId }),
    },
    "Failed to push content",
  );
}

export function discardModuleOperation(sessionId: string, operationId: string) {
  return sendJson<Record<string, unknown>>(
    `/canvas/sessions/${sessionId}/module-operations/${operationId}`,
    { method: "DELETE" },
    "Failed to discard module operation",
  );
}

export function discardAllModuleOperations(sessionId: string) {
  return sendJson<Record<string, unknown>>(
    `/canvas/sessions/${sessionId}/module-operations`,
    { method: "DELETE" },
    "Failed to discard module operations",
  );
}

export function applyModuleOperations(sessionId: string, operationIds: string[]) {
  return sendJson<{
    applied: Array<{ id: string; operation_type: string; after_state: Record<string, unknown> }>;
    counts: { applied: number; failed: number; total: number };
  }>(
    `/canvas/sessions/${sessionId}/module-operations/apply`,
    {
      method: "POST",
      body: JSON.stringify({ operation_ids: operationIds }),
    },
    "Failed to apply module operations",
  );
}
