"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Card, CardBody } from "@/components/edplus";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export default function TagFlowPreviewGenerateButton({
  sessionId,
  documentId,
  pageNumbers,
  status,
}: {
  sessionId: string;
  documentId: string;
  pageNumbers: number[];
  status?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniquePageNumbers = Array.from(new Set(pageNumbers.filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)));
  const active = status?.toLowerCase() === "queued" || status?.toLowerCase() === "running" || status?.toLowerCase() === "retrying";

  async function queuePreviews() {
    if (!uniquePageNumbers.length || loading) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/previews`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_numbers: uniquePageNumbers }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to queue TagFlow previews"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue TagFlow previews");
    } finally {
      setLoading(false);
    }
  }

  if (!uniquePageNumbers.length) return null;

  return (
    <Card className="mt-5 bg-surface-container-low">
      <CardBody className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-bold text-on-surface">
            {uniquePageNumbers.length} page{uniquePageNumbers.length === 1 ? "" : "s"} need preview images
          </div>
          <div className="mt-1 text-xs text-on-surface-variant">
            Generate previews to edit zones on non-sample pages.
          </div>
        </div>
        <Button
          type="button"
          disabled={loading || active}
          loading={loading}
          onClick={() => void queuePreviews()}
        >
          {active ? "Preview job running" : "Generate missing previews"}
        </Button>
      </div>
      {error ? (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
      </CardBody>
    </Card>
  );
}
