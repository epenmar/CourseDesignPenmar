import { createClient } from "@/lib/supabase/client";

import type { QueueDiagnosticsResponse } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

async function accessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export async function loadQueueDiagnostics(limit = 500): Promise<QueueDiagnosticsResponse> {
  const token = await accessToken();
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${API_URL}/admin/queue-diagnostics?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load queue diagnostics"));
  return await res.json() as QueueDiagnosticsResponse;
}

export async function retryQueueJob(jobId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch(`${API_URL}/admin/queue-diagnostics/jobs/${jobId}/retry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to retry queue job"));
}
