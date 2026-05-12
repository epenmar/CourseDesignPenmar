import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string; imageId: string }> }
) {
  const { sessionId, imageId } = await context.params;
  const variant = request.nextUrl.searchParams.get("variant") === "original" ? "original" : "thumb";
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const response = await fetch(
    `${API_URL}/canvas/sessions/${sessionId}/images/${imageId}/asset?variant=${variant}`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    return new NextResponse(detail || "Image proxy failed", {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "text/plain; charset=utf-8" },
    });
  }

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, max-age=3600",
      "X-CanvasCurate-Cache": response.headers.get("X-CanvasCurate-Cache") ?? "proxy",
      "X-CanvasCurate-R2-Configured": response.headers.get("X-CanvasCurate-R2-Configured") ?? "unknown",
      "X-CanvasCurate-R2-Bucket": response.headers.get("X-CanvasCurate-R2-Bucket") ?? "unknown",
      "X-CanvasCurate-R2-Key": response.headers.get("X-CanvasCurate-R2-Key") ?? "unknown",
    },
  });
}
