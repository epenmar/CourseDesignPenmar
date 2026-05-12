import { createClient } from "@/lib/supabase/client";
import type {
  CourseCreationJob,
  CourseCreationDraftPreview,
  CourseCreationOutline,
  CourseCreationProject,
  CourseCreationSetup,
  CourseCreationSource,
  CourseCreationSourceAnalysisItem,
} from "../types";

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

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  return res;
}

export async function loadCourseCreationProject(sessionId: string): Promise<CourseCreationProject> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Course Creation project"));
  return await res.json() as CourseCreationProject;
}

export async function saveCourseCreationSetup(
  sessionId: string,
  setup: CourseCreationSetup,
): Promise<CourseCreationProject> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setup),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to save Course Creation setup"));
  return await res.json() as CourseCreationProject;
}

export async function uploadCourseCreationSource(
  sessionId: string,
  file: File,
): Promise<{ source: CourseCreationSource; job: CourseCreationJob }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/sources`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to upload source file"));
  return await res.json() as { source: CourseCreationSource; job: CourseCreationJob };
}

export async function queueCourseCreationExtraction(
  sessionId: string,
  sourceId: string,
): Promise<{ source: CourseCreationSource; job: CourseCreationJob }> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/sources/${sourceId}/extract`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to queue source extraction"));
  return await res.json() as { source: CourseCreationSource; job: CourseCreationJob };
}

export async function deleteCourseCreationSource(sessionId: string, sourceId: string): Promise<void> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to remove source file"));
}

export async function loadCourseCreationSourceChunks(
  sessionId: string,
): Promise<CourseCreationSourceAnalysisItem[]> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/source-chunks`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load source chunks"));
  const body = await res.json() as { items?: CourseCreationSourceAnalysisItem[] };
  return body.items ?? [];
}

export async function generateCourseCreationOutline(
  sessionId: string,
): Promise<{ project: CourseCreationProject; job: CourseCreationJob }> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/outline/generate`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to generate course outline"));
  return await res.json() as { project: CourseCreationProject; job: CourseCreationJob };
}

export async function saveCourseCreationOutline(
  sessionId: string,
  outline: CourseCreationOutline,
): Promise<CourseCreationProject> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/outline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outline }),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to save reviewed outline"));
  return await res.json() as CourseCreationProject;
}

export async function generateCourseCreationDrafts(
  sessionId: string,
): Promise<{ project: CourseCreationProject; job: CourseCreationJob }> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/drafts/generate`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to create editable drafts"));
  return await res.json() as { project: CourseCreationProject; job: CourseCreationJob };
}

export async function loadCourseCreationDraftPreview(
  sessionId: string,
): Promise<CourseCreationDraftPreview> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/drafts/preview`);
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load generated draft preview"));
  return await res.json() as CourseCreationDraftPreview;
}

export async function confirmCourseCreationExport(sessionId: string): Promise<CourseCreationProject> {
  const res = await authedFetch(`/canvas/sessions/${sessionId}/course-creation/export/confirm`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to confirm Canvas Clean export"));
  const payload = await res.json() as { project: CourseCreationProject };
  return payload.project;
}
