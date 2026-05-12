import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string; documentId: string; figureId: string }> }
) {
  const { sessionId, documentId, figureId } = await context.params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const response = await fetch(
    `${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${figureId}/asset`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    return new NextResponse(detail || "PDF figure proxy failed", {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
      },
    });
  }

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/webp",
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, max-age=3600",
      "X-CanvasCurate-Cache": response.headers.get("X-CanvasCurate-Cache") ?? "proxy",
      "X-CanvasCurate-Asset-Bytes": response.headers.get("X-CanvasCurate-Asset-Bytes") ?? String(body.byteLength),
      "X-CanvasCurate-Backend-Ms": response.headers.get("X-CanvasCurate-Backend-Ms") ?? "",
      "X-CanvasCurate-Backend-Session-Ms": response.headers.get("X-CanvasCurate-Backend-Session-Ms") ?? "",
      "X-CanvasCurate-Backend-Document-Ms": response.headers.get("X-CanvasCurate-Backend-Document-Ms") ?? "",
      "X-CanvasCurate-Backend-Asset-Lookup-Ms": response.headers.get("X-CanvasCurate-Backend-Asset-Lookup-Ms") ?? "",
      "X-CanvasCurate-R2-Ms": response.headers.get("X-CanvasCurate-R2-Ms") ?? "",
      "X-CanvasCurate-Render-Ms": response.headers.get("X-CanvasCurate-Render-Ms") ?? "",
    },
  });
}
