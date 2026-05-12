import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string; documentId: string; pageNumber: string }> }
) {
  const requestStarted = performance.now();
  const { sessionId, documentId, pageNumber } = await context.params;
  const variant = request.nextUrl.searchParams.get("variant") === "tagged" ? "tagged" : "original";
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const authFinished = performance.now();

  if (!session) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const backendFetchStarted = performance.now();
  const response = await fetch(
    `${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/pages/${pageNumber}/asset?variant=${variant}`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }
  );
  const backendFetchFinished = performance.now();

  if (!response.ok) {
    const detail = await response.text();
    return new NextResponse(detail || "Document preview proxy failed", {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
        "X-CanvasCurate-Frontend-Proxy-Ms": String(Math.round((performance.now() - requestStarted) * 10) / 10),
        "X-CanvasCurate-Frontend-Auth-Ms": String(Math.round((authFinished - requestStarted) * 10) / 10),
        "X-CanvasCurate-Frontend-Backend-Fetch-Ms": String(Math.round((backendFetchFinished - backendFetchStarted) * 10) / 10),
        "X-CanvasCurate-Backend-Ms": response.headers.get("X-CanvasCurate-Backend-Ms") ?? "",
        "X-CanvasCurate-R2-Ms": response.headers.get("X-CanvasCurate-R2-Ms") ?? "",
      },
    });
  }

  const bodyReadStarted = performance.now();
  const body = await response.arrayBuffer();
  const bodyReadFinished = performance.now();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/webp",
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, max-age=3600",
      "X-CanvasCurate-Cache": response.headers.get("X-CanvasCurate-Cache") ?? "proxy",
      "X-CanvasCurate-Preview-Variant": response.headers.get("X-CanvasCurate-Preview-Variant") ?? variant,
      "X-CanvasCurate-Frontend-Proxy-Ms": String(Math.round((bodyReadFinished - requestStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Auth-Ms": String(Math.round((authFinished - requestStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Backend-Fetch-Ms": String(Math.round((backendFetchFinished - backendFetchStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Body-Read-Ms": String(Math.round((bodyReadFinished - bodyReadStarted) * 10) / 10),
      "X-CanvasCurate-Backend-Ms": response.headers.get("X-CanvasCurate-Backend-Ms") ?? "",
      "X-CanvasCurate-Backend-Session-Ms": response.headers.get("X-CanvasCurate-Backend-Session-Ms") ?? "",
      "X-CanvasCurate-Backend-Document-Ms": response.headers.get("X-CanvasCurate-Backend-Document-Ms") ?? "",
      "X-CanvasCurate-Backend-Asset-Lookup-Ms": response.headers.get("X-CanvasCurate-Backend-Asset-Lookup-Ms") ?? "",
      "X-CanvasCurate-R2-Ms": response.headers.get("X-CanvasCurate-R2-Ms") ?? "",
      "X-CanvasCurate-Asset-Bytes": response.headers.get("X-CanvasCurate-Asset-Bytes") ?? String(body.byteLength),
    },
  });
}
