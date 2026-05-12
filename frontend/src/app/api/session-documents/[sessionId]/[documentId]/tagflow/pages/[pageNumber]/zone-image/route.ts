import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string; documentId: string; pageNumber: string }> }
) {
  const requestStarted = performance.now();
  const { sessionId, documentId, pageNumber } = await context.params;
  const query = request.nextUrl.searchParams;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const authFinished = performance.now();

  if (!session) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const backendUrl = new URL(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/pages/${pageNumber}/zone-image`);
  ["x", "y", "width", "height"].forEach((key) => {
    const value = query.get(key);
    if (value !== null) backendUrl.searchParams.set(key, value);
  });

  const backendFetchStarted = performance.now();
  const response = await fetch(backendUrl, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  const backendFetchFinished = performance.now();

  if (!response.ok) {
    const detail = await response.text();
    return new NextResponse(detail || "Zone image proxy failed", {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
        "X-CanvasCurate-Frontend-Proxy-Ms": String(Math.round((performance.now() - requestStarted) * 10) / 10),
        "X-CanvasCurate-Frontend-Auth-Ms": String(Math.round((authFinished - requestStarted) * 10) / 10),
        "X-CanvasCurate-Frontend-Backend-Fetch-Ms": String(Math.round((backendFetchFinished - backendFetchStarted) * 10) / 10),
        "X-CanvasCurate-Backend-Ms": response.headers.get("X-CanvasCurate-Backend-Ms") ?? "",
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
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, max-age=900",
      "X-CanvasCurate-Cache": response.headers.get("X-CanvasCurate-Cache") ?? "proxy",
      "X-CanvasCurate-Zone-Width": response.headers.get("X-CanvasCurate-Zone-Width") ?? "",
      "X-CanvasCurate-Zone-Height": response.headers.get("X-CanvasCurate-Zone-Height") ?? "",
      "X-CanvasCurate-Frontend-Proxy-Ms": String(Math.round((bodyReadFinished - requestStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Auth-Ms": String(Math.round((authFinished - requestStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Backend-Fetch-Ms": String(Math.round((backendFetchFinished - backendFetchStarted) * 10) / 10),
      "X-CanvasCurate-Frontend-Body-Read-Ms": String(Math.round((bodyReadFinished - bodyReadStarted) * 10) / 10),
      "X-CanvasCurate-Backend-Ms": response.headers.get("X-CanvasCurate-Backend-Ms") ?? "",
      "X-CanvasCurate-Crop-Ms": response.headers.get("X-CanvasCurate-Crop-Ms") ?? "",
      "X-CanvasCurate-Asset-Bytes": response.headers.get("X-CanvasCurate-Asset-Bytes") ?? String(body.byteLength),
    },
  });
}
