"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type ModuleMoveTarget = {
  id: string;
  name: string;
  itemCount: number;
};

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export default function ModuleItemStageActions({
  sessionId,
  moduleItemId,
  currentModuleId,
  modules,
  published,
  indent,
  title,
  stagedOperationId,
  stagedPublished,
  stagedIndentOperationId,
  stagedIndent,
  stagedRemoveOperationId,
  stagedRenameOperationId,
  stagedTitle,
}: {
  sessionId: string;
  moduleItemId: string;
  currentModuleId: string;
  modules: ModuleMoveTarget[];
  published: boolean | null;
  indent: number;
  title: string;
  stagedOperationId?: string | null;
  stagedPublished?: boolean | null;
  stagedIndentOperationId?: string | null;
  stagedIndent?: number | null;
  stagedRemoveOperationId?: string | null;
  stagedRenameOperationId?: string | null;
  stagedTitle?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState(Boolean(stagedOperationId));
  const [operationId, setOperationId] = useState<string | null>(stagedOperationId ?? null);
  const [localStagedPublished, setLocalStagedPublished] = useState<boolean | null>(stagedPublished ?? null);
  const [indentBusy, setIndentBusy] = useState(false);
  const [indentOperationId, setIndentOperationId] = useState<string | null>(stagedIndentOperationId ?? null);
  const [localStagedIndent, setLocalStagedIndent] = useState<number | null>(stagedIndent ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [movePlacement, setMovePlacement] = useState<"top" | "bottom">("bottom");
  const [selectedMoveModuleId, setSelectedMoveModuleId] = useState(
    modules.find((module) => module.id !== currentModuleId)?.id ?? "",
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameOperationId, setRenameOperationId] = useState<string | null>(stagedRenameOperationId ?? null);
  const [renameTitle, setRenameTitle] = useState(stagedTitle ?? title);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeOperationId, setRemoveOperationId] = useState<string | null>(stagedRemoveOperationId ?? null);
  const [error, setError] = useState(false);
  const [baselinePublished, setBaselinePublished] = useState(Boolean(published));
  const [baselineIndent, setBaselineIndent] = useState(Math.max(0, Math.min(5, indent ?? 0)));
  const effectivePublished = staged && localStagedPublished !== null ? localStagedPublished : baselinePublished;
  const nextPublished = !effectivePublished;
  const effectiveIndent = localStagedIndent ?? baselineIndent;
  const actionBusy = busy || indentBusy || moveBusy || renameBusy || removeBusy;
  const moveTargets = modules.filter((module) => module.id !== currentModuleId);
  const selectedMoveModule = moveTargets.find((module) => module.id === selectedMoveModuleId) ?? moveTargets[0] ?? null;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuWidth = 192;
  const menuHeight = 260;

  useEffect(() => {
    function handleApplied(event: Event) {
      const detail = (event as CustomEvent<{
        applied?: Array<{ module_item_id?: string; after_state?: { title?: string; published?: boolean; indent?: number; position?: number; removed?: boolean } }>;
      }>).detail;
      const applied = detail?.applied?.filter((operation) => operation.module_item_id === moduleItemId) ?? [];
      for (const operation of applied) {
        if (typeof operation.after_state?.published === "boolean") {
          setBaselinePublished(operation.after_state.published);
          setStaged(false);
          setOperationId(null);
          setLocalStagedPublished(null);
        }
        if (typeof operation.after_state?.indent === "number") {
          setBaselineIndent(Math.max(0, Math.min(5, operation.after_state.indent)));
          setIndentOperationId(null);
          setLocalStagedIndent(null);
        }
        if (typeof operation.after_state?.title === "string") {
          setRenameOperationId(null);
          setRenameTitle(operation.after_state.title);
        }
        if (operation.after_state?.removed === true) {
          setRemoveOperationId(null);
        }
      }
    }

    window.addEventListener("canvascurate:module-operations-applied", handleApplied);
    return () => window.removeEventListener("canvascurate:module-operations-applied", handleApplied);
  }, [moduleItemId]);

  useEffect(() => {
    function handleDeleted(event: Event) {
      const detail = (event as CustomEvent<{ operationId?: string; all?: boolean }>).detail;
      if (detail?.all || (detail?.operationId && detail.operationId === operationId)) {
        setStaged(false);
        setOperationId(null);
        setLocalStagedPublished(null);
      }
      if (detail?.all || (detail?.operationId && detail.operationId === indentOperationId)) {
        setIndentOperationId(null);
        setLocalStagedIndent(null);
      }
      if (detail?.all || (detail?.operationId && detail.operationId === removeOperationId)) {
        setRemoveOperationId(null);
      }
      if (detail?.all || (detail?.operationId && detail.operationId === renameOperationId)) {
        setRenameOperationId(null);
        setRenameTitle(title);
      }
    }

    window.addEventListener("canvascurate:module-operation-deleted", handleDeleted);
    return () => window.removeEventListener("canvascurate:module-operation-deleted", handleDeleted);
  }, [indentOperationId, operationId, removeOperationId, renameOperationId, title]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      const root = menuButtonRef.current?.parentElement;
      if (root?.contains(event.target)) return;
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function openMenu() {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      setMenuOpen((current) => !current);
      return;
    }
    const gap = 8;
    const viewportPadding = 8;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );
    const preferredTop = rect.bottom + gap;
    const top = preferredTop + menuHeight <= window.innerHeight - viewportPadding
      ? preferredTop
      : Math.max(viewportPadding, rect.top - menuHeight - gap);
    setMenuPosition({ left, top });
    setMenuOpen((current) => !current);
  }

  async function stagePublishToggle() {
    setBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      if (staged && operationId) {
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations/${operationId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to unstage module operation"));
        }
        setStaged(false);
        setOperationId(null);
        setLocalStagedPublished(null);
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
        return;
      }

      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "item_publish",
          module_item_id: moduleItemId,
          after_state: { published: nextPublished },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage module operation"));
      }
      const data = await res.json() as { staged: boolean; operation?: { id: string } | null };
      setStaged(data.staged);
      setOperationId(data.operation?.id ?? null);
      setLocalStagedPublished(data.staged ? nextPublished : null);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function stageIndent(nextIndent: number) {
    const boundedIndent = Math.max(0, Math.min(5, nextIndent));
    setIndentBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "item_indent",
          module_item_id: moduleItemId,
          after_state: { indent: boundedIndent },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage indent change"));
      }
      const data = await res.json() as { staged: boolean; operation?: { id: string } | null };
      setIndentOperationId(data.operation?.id ?? null);
      setLocalStagedIndent(data.staged ? boundedIndent : null);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch {
      setError(true);
    } finally {
      setIndentBusy(false);
    }
  }

  async function stageRename(nextTitle: string) {
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return;
    setRenameBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "item_rename",
          module_item_id: moduleItemId,
          after_state: { title: trimmedTitle },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage rename"));
      }
      const data = await res.json() as { staged: boolean; operation?: { id: string } | null };
      setRenameOperationId(data.operation?.id ?? null);
      setRenameTitle(data.staged ? trimmedTitle : title);
      setRenameOpen(false);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setRenameBusy(false);
    }
  }

  async function stageMove() {
    if (!selectedMoveModule) return;
    setMoveBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const nextPosition = movePlacement === "top" ? 1 : selectedMoveModule.itemCount + 1;
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "item_move",
          module_item_id: moduleItemId,
          after_state: {
            module_id: selectedMoveModule.id,
            position: nextPosition,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage move"));
      }
      setMoveOpen(false);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setMoveBusy(false);
    }
  }

  async function stageRemove() {
    setRemoveBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "item_remove",
          module_item_id: moduleItemId,
          after_state: { removed: true },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage module item removal"));
      }
      const data = await res.json() as { staged: boolean; operation?: { id: string } | null };
      setRemoveOperationId(data.operation?.id ?? null);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="relative flex flex-none items-center gap-1">
      <button
        type="button"
        disabled={busy || Boolean(removeOperationId)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void stagePublishToggle();
        }}
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-black transition-colors ${
          error
            ? "border-error/40 bg-error/10 text-error"
            : effectivePublished
              ? "border-green-600 bg-green-600 text-white hover:bg-green-700"
              : "border-outline-variant bg-white text-transparent hover:bg-surface-container-low"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={
          staged
            ? `Pending ${effectivePublished ? "publish" : "unpublish"} change. Click to cancel.`
            : effectivePublished
              ? "Published. Click to stage unpublish."
              : "Unpublished. Click to stage publish."
        }
        aria-label={effectivePublished ? "Published. Click to stage unpublish." : "Unpublished. Click to stage publish."}
      >
        {busy ? "..." : effectivePublished ? "✓" : ""}
        {staged ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-[#ffc627]" />
        ) : null}
      </button>
      {indentOperationId ? (
        <span className="rounded-full bg-[#ffc627]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#6f4e00]">
          Indent {effectiveIndent}
        </span>
      ) : null}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-md border bg-white text-sm font-bold transition-colors hover:bg-surface-container-low ${
          error ? "border-error/40 text-error" : "border-outline-variant/40 text-on-surface-variant"
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Module item actions"
        title="Module item actions"
      >
        ...
      </button>
      {menuOpen ? (
        <div
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-outline-variant/30 bg-white py-1 text-sm shadow-lg"
          style={menuPosition ?? undefined}
          role="menu"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            disabled={actionBusy || Boolean(removeOperationId)}
            onClick={() => {
              setRenameTitle(stagedTitle ?? title);
              setRenameOpen(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <span>Rename</span>
            {renameOperationId ? <span className="h-2 w-2 rounded-full bg-[#ffc627]" /> : null}
          </button>
          <button
            type="button"
            disabled={actionBusy || Boolean(removeOperationId)}
            onClick={() => {
              setMenuOpen(false);
              void stagePublishToggle();
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <span>{effectivePublished ? "Unpublish" : "Publish"}</span>
            {staged ? <span className="h-2 w-2 rounded-full bg-[#ffc627]" /> : null}
          </button>
          <button
            type="button"
            disabled={actionBusy || effectiveIndent <= 0 || Boolean(removeOperationId)}
            onClick={() => {
              setMenuOpen(false);
              void stageIndent(effectiveIndent - 1);
            }}
            className="block w-full px-3 py-2 text-left text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            Decrease indent
          </button>
          <button
            type="button"
            disabled={actionBusy || effectiveIndent >= 5 || Boolean(removeOperationId)}
            onClick={() => {
              setMenuOpen(false);
              void stageIndent(effectiveIndent + 1);
            }}
            className="block w-full px-3 py-2 text-left text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            Increase indent
          </button>
          <div className="my-1 h-px bg-outline-variant/30" />
          <button
            type="button"
            disabled={actionBusy || Boolean(removeOperationId) || moveTargets.length === 0}
            onClick={() => {
              if (!selectedMoveModuleId && moveTargets[0]) {
                setSelectedMoveModuleId(moveTargets[0].id);
              }
              setMoveOpen(true);
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            Move to module
          </button>
          <button
            type="button"
            disabled={actionBusy || Boolean(removeOperationId)}
            onClick={() => {
              setMenuOpen(false);
              void stageRemove();
            }}
            className={`block w-full px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              removeOperationId ? "bg-[#cc2f2f] text-white" : "text-error hover:bg-error/10"
            }`}
            role="menuitem"
          >
            {removeOperationId ? "Pending removal" : "Remove from module"}
          </button>
        </div>
      ) : null}
      {moveOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Move module item"
          onClick={() => setMoveOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-outline-variant/30 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-bold text-on-surface">Move to module</p>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
              Module
            </label>
            <select
              value={selectedMoveModuleId}
              onChange={(event) => setSelectedMoveModuleId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              {moveTargets.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.name}
                </option>
              ))}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["top", "bottom"] as const).map((placement) => (
                <button
                  key={placement}
                  type="button"
                  onClick={() => setMovePlacement(placement)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                    movePlacement === placement
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  {placement === "top" ? "At the Top" : "At the Bottom"}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={moveBusy || !selectedMoveModule}
                onClick={() => void stageMove()}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {moveBusy ? "Moving..." : "Move"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {renameOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Rename module item"
          onClick={() => setRenameOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-outline-variant/30 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-bold text-on-surface">Rename module item</p>
            <input
              type="text"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void stageRename(renameTitle);
                }
                if (event.key === "Escape") {
                  setRenameOpen(false);
                }
              }}
              className="mt-3 w-full rounded-lg border border-outline-variant/50 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={renameBusy || !renameTitle.trim()}
                onClick={() => void stageRename(renameTitle)}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {renameBusy ? "Saving..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
