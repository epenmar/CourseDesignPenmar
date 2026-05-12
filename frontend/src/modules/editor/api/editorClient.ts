"use client";

/**
 * API helpers for editor-owned Canvas content operations.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export type EditorRevisionRow = {
  id: string;
  revision_number: number;
  before_title: string | null;
  after_title: string | null;
  change_summary: string | null;
  created_at: string;
};

export type EditorSaveResponse = {
  id: string;
  title: string | null;
  canvas_url?: string | null;
  published: boolean | null;
  html_body: string;
  plain_text: string;
  revision_count: number;
  saved?: boolean;
  revision_number?: number;
  pushed?: boolean;
};

export type CanvasRevisionRow = {
  revision_id: number;
  updated_at: string | null;
  latest?: boolean | null;
  edited_by?: {
    id?: number | string | null;
    display_name?: string | null;
  } | null;
  title?: string | null;
};

export type CanvasRevisionPreview = CanvasRevisionRow & {
  body: string;
};

export type SourceCourse = {
  course_id: string;
  name: string;
  course_code?: string | null;
  workflow_state?: string | null;
  term_name?: string | null;
};

export type SourcePageMatch = {
  page_url: string;
  title: string;
  html_url?: string | null;
  updated_at?: string | null;
  published?: boolean | null;
};

export type SourcePagePreview = SourcePageMatch & {
  body: string;
};

export type EditorImageUploadResponse = {
  image: {
    id: string;
    canvas_url: string;
    edited_alt_text: string | null;
    long_description: string | null;
    is_decorative: boolean;
  };
  insert: {
    src: string;
    alt?: string | null;
    title?: string | null;
    canvas_file_id?: string | null;
  };
};

export type EditorFileUploadResponse = {
  file: {
    content_item_id: string | null;
    canvas_file_id: string;
    canvas_url: string;
    filename: string;
    title: string;
    content_type: string;
    size: number;
    document_id: string | null;
    stored_in_r2: boolean;
    initial_accessibility_review?: {
      status: string;
      issues: Array<{ code: string; message: string }>;
      page_count?: number | null;
    } | null;
  };
  insert: {
    href: string;
    text: string;
    canvas_file_id: string;
  };
};

export type ImageReviewGenerateResponse = {
  job_id?: string;
  status?: string;
  edited_alt_text?: string | null;
  long_description?: string | null;
  is_decorative?: boolean;
};

type SaveEditorContentPayload = {
  change_summary: string;
  html_body: string;
  title: string;
};

type LoadSourceCoursesOptions = {
  cursor?: string | null;
  query?: string;
};

type SaveImageReviewPayload = {
  edited_alt_text: string | null;
  is_decorative: boolean;
  long_description: string | null;
  review_action: "keep";
};

type RewriteEditorTextPayload = {
  context: string;
  instruction: string;
  text: string;
};

type GenerateEditorContentPayload = {
  additional_context: string | null;
  context: string;
  prompt: string;
};

export async function parseEditorApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export async function fetchEditorJson<T>(path: string, token: string, fallback: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, fallback));
  }
  return res.json() as Promise<T>;
}

export async function loadEditorRevisions(
  sessionId: string,
  contentItemId: string,
  token: string,
) {
  const data = await fetchEditorJson<{ items: EditorRevisionRow[] }>(
    `/canvas/sessions/${sessionId}/content/${contentItemId}/revisions`,
    token,
    "Failed to load revisions",
  );
  return data.items;
}

export async function saveEditorContent(
  sessionId: string,
  contentItemId: string,
  token: string,
  payload: SaveEditorContentPayload,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to save content"));
  }
  return res.json() as Promise<EditorSaveResponse>;
}

export async function pushEditorContentToCanvas(
  sessionId: string,
  contentItemId: string,
  token: string,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to push content to Canvas"));
  }
  return res.json() as Promise<EditorSaveResponse>;
}

export async function restoreEditorRevision(
  sessionId: string,
  contentItemId: string,
  revisionId: string,
  token: string,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/revisions/${revisionId}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to restore revision"));
  }
  return res.json() as Promise<EditorSaveResponse>;
}

export async function loadCanvasRevisions(
  sessionId: string,
  contentItemId: string,
  token: string,
) {
  const data = await fetchEditorJson<{ items: CanvasRevisionRow[] }>(
    `/canvas/sessions/${sessionId}/content/${contentItemId}/canvas-revisions`,
    token,
    "Failed to load Canvas revisions",
  );
  return data.items;
}

export async function loadCanvasRevisionPreview(
  sessionId: string,
  contentItemId: string,
  revisionId: number,
  token: string,
) {
  return fetchEditorJson<CanvasRevisionPreview>(
    `/canvas/sessions/${sessionId}/content/${contentItemId}/canvas-revisions/${revisionId}`,
    token,
    "Failed to load Canvas revision preview",
  );
}

export async function restoreCanvasRevision(
  sessionId: string,
  contentItemId: string,
  revisionId: number,
  token: string,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/canvas-revisions/${revisionId}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to restore Canvas revision"));
  }
  return res.json() as Promise<EditorSaveResponse>;
}

export async function saveEditorIssueFlag(
  sessionId: string,
  contentItemId: string,
  token: string,
  note: string,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/issues`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      issue_type: "flag_issue",
      note,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to flag issue"));
  }
}

export async function loadSourceCourses(
  sessionId: string,
  token: string,
  options: LoadSourceCoursesOptions = {},
) {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.cursor) params.set("cursor", options.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchEditorJson<{ items: SourceCourse[]; next_cursor?: string | null }>(
    `/canvas/sessions/${sessionId}/source-courses${suffix}`,
    token,
    "Failed to load source courses",
  );
}

export async function loadSourcePages(
  sessionId: string,
  token: string,
  sourceCourseId: string,
  title: string,
) {
  const data = await fetchEditorJson<{ items: SourcePageMatch[] }>(
    `/canvas/sessions/${sessionId}/source-pages?source_course_id=${encodeURIComponent(sourceCourseId)}&title=${encodeURIComponent(title)}`,
    token,
    "Failed to search source pages",
  );
  return data.items;
}

export async function loadSourcePagePreview(
  sessionId: string,
  token: string,
  sourceCourseId: string,
  pageUrl: string,
) {
  return fetchEditorJson<SourcePagePreview>(
    `/canvas/sessions/${sessionId}/source-page?source_course_id=${encodeURIComponent(sourceCourseId)}&page_url=${encodeURIComponent(pageUrl)}`,
    token,
    "Failed to load source page preview",
  );
}

export async function replaceEditorContentFromSourcePage(
  sessionId: string,
  contentItemId: string,
  token: string,
  sourceCourseId: string,
  sourcePageUrl: string,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/replace-from-source-page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source_course_id: sourceCourseId,
      source_page_url: sourcePageUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to replace from source page"));
  }
  return res.json() as Promise<EditorSaveResponse>;
}

export async function uploadEditorImage(
  sessionId: string,
  contentItemId: string,
  token: string,
  file: File,
) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/images/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to upload image"));
  }
  return res.json() as Promise<EditorImageUploadResponse>;
}

export async function uploadEditorFile(
  sessionId: string,
  contentItemId: string,
  token: string,
  file: File,
) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to upload file"));
  }
  return res.json() as Promise<EditorFileUploadResponse>;
}

export async function generateImageReviewText(
  sessionId: string,
  imageId: string,
  token: string,
  mode: "alt" | "long_desc" | "both",
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode, overwrite_existing: true }),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to generate image text"));
  }
  return res.json() as Promise<ImageReviewGenerateResponse>;
}

export async function loadImageReview(
  sessionId: string,
  imageId: string,
  token: string,
) {
  return fetchEditorJson<ImageReviewGenerateResponse>(
    `/canvas/sessions/${sessionId}/images/${imageId}`,
    token,
    "Failed to load image review",
  );
}

export async function saveImageReview(
  sessionId: string,
  imageId: string,
  token: string,
  payload: SaveImageReviewPayload,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to save image accessibility text"));
  }
}

export async function rewriteEditorText(
  sessionId: string,
  token: string,
  payload: RewriteEditorTextPayload,
  fallback = "Failed to rewrite selection",
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/ai-rewrite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, fallback));
  }
  return res.json() as Promise<{ result?: string }>;
}

export async function generateEditorContent(
  sessionId: string,
  token: string,
  payload: GenerateEditorContentPayload,
) {
  const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/ai-generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseEditorApiError(res, "Failed to generate content"));
  }
  return res.json() as Promise<{ html?: string }>;
}
