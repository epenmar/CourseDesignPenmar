"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileJson, Package } from "lucide-react";
import Button from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import Modal from "@/components/edplus/Modal";
import Badge from "@/components/edplus/Badge";

// Client component that drives the inbox row interactions.
//
// Why a client component:
//   - View Bundle opens a modal with the full JSONB blob fetched
//     on-demand (kept off the list payload so the list renders fast).
//   - Start Build PATCHes the handoff's status optimistically and
//     removes it from the pending list.
//   - The page reads ?handoff=<id> and scrolls/highlights that row,
//     which needs window + useEffect.

type HandoffSummary = {
  id: string;
  received_at: string;
  status: string;
  course_code: string | null;
  course_title: string | null;
  generated_by: string | null;
  generated_role: string | null;
  source: string | null;
  processed_at: string | null;
  notes: string | null;
};

type FullHandoff = HandoffSummary & {
  bundle: {
    handoff?: Record<string, unknown>;
    spec?: Record<string, unknown>;
  };
};

interface Props {
  handoffs: HandoffSummary[];
  apiUrl: string;
  token: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

export default function IncomingHandoffsList({ handoffs, apiUrl, token }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("handoff");

  // Local copy of the list so optimistic updates don't require a full
  // server round-trip. router.refresh() syncs against the database at
  // the end of every action.
  const [rows, setRows] = useState<HandoffSummary[]>(handoffs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleFull, setBundleFull] = useState<FullHandoff | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [bundleLoadingFor, setBundleLoadingFor] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Scroll the deep-linked row into view + flash it briefly so the
  // user can tell the worksheet's handoff landed where it expected.
  useEffect(() => {
    if (!highlightId) return;
    const el = highlightRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2");
      const t = setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
      }, 2200);
      return () => clearTimeout(t);
    }
  }, [highlightId]);

  async function openBundle(id: string) {
    setBundleOpen(true);
    setBundleFull(null);
    setBundleError(null);
    setBundleLoadingFor(id);
    try {
      const res = await fetch(`${apiUrl}/api/coursecompose/handoff/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as { handoff: FullHandoff };
      setBundleFull(data.handoff);
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : "unknown");
    } finally {
      setBundleLoadingFor(null);
    }
  }

  async function startBuild(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`${apiUrl}/api/coursecompose/handoff/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: "processing" }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      // Optimistically drop the row from the pending list — it's no
      // longer "pending." Server-side it's now status=processing, and
      // a future build pipeline will flip it to 'built' or 'error'.
      setRows((current) => current.filter((r) => r.id !== id));
      router.refresh();
    } catch (err) {
      alert(`Could not start build: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="space-y-3">
        {rows.map((r) => {
          const isHighlight = r.id === highlightId;
          return (
            <Card
              key={r.id}
              className={isHighlight ? "transition-shadow" : ""}
            >
              <div ref={isHighlight ? highlightRef : null}>
                <CardBody className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="primary" className="rounded-md text-[10px] uppercase tracking-wider">
                          {r.course_code ?? "—"}
                        </Badge>
                        <h3 className="font-headline text-lg font-bold text-on-surface truncate">
                          {r.course_title ?? "Untitled course"}
                        </h3>
                      </div>
                      <div className="mt-2 text-xs text-on-surface-variant flex flex-wrap gap-x-4 gap-y-1">
                        <span>Received {timeAgo(r.received_at)}</span>
                        {r.generated_by && (
                          <span>From {r.generated_by}{r.generated_role ? ` (${r.generated_role})` : ""}</span>
                        )}
                        {r.source && r.source !== "unknown" && (
                          <span className="font-mono text-[11px]">{r.source}</span>
                        )}
                      </div>
                      {r.notes && (
                        <div className="mt-2 text-xs text-on-surface-variant italic">
                          {r.notes}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<FileJson size={14} />}
                        onClick={() => openBundle(r.id)}
                        disabled={busyId === r.id}
                      >
                        View bundle
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Package size={14} />}
                        onClick={() => startBuild(r.id)}
                        loading={busyId === r.id}
                        disabled={busyId !== null}
                      >
                        Start build
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal
        open={bundleOpen}
        onOpenChange={setBundleOpen}
        title={bundleFull
          ? `${bundleFull.course_code ?? "—"} — ${bundleFull.course_title ?? "Untitled"}`
          : "Handoff bundle"}
        subtitle={bundleFull
          ? `Received ${timeAgo(bundleFull.received_at)}${bundleFull.generated_by ? ` from ${bundleFull.generated_by}` : ""}`
          : undefined}
        size="2xl"
      >
        {bundleLoadingFor && !bundleFull && !bundleError && (
          <div className="py-8 text-center text-on-surface-variant text-sm">Loading bundle…</div>
        )}
        {bundleError && (
          <div className="py-8 text-center text-error text-sm">Could not load bundle: {bundleError}</div>
        )}
        {bundleFull && (
          <div className="space-y-3">
            <div className="text-xs text-on-surface-variant">
              The full CourseCompose spec is below. Curate&apos;s build pipeline (forthcoming) will
              consume this to create the Canvas course modules, pages, and items.
            </div>
            <pre className="bg-surface-container-lowest rounded-lg p-4 text-xs overflow-auto max-h-[60vh] border border-outline-variant">
{JSON.stringify(bundleFull.bundle, null, 2)}
            </pre>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant pt-2 border-t border-outline-variant">
              <CheckCircle2 size={14} className="text-primary" />
              <span>Click <strong>Start build</strong> on the row to move this to <code>processing</code>.</span>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
