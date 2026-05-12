"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

function readCollapsedIds(storageKey: string) {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function notifyCollapseUpdated(storageKey: string, collapsedIds: string[]) {
  window.queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent("canvascurate:module-collapse-updated", {
      detail: { storageKey, collapsedIds },
    }));
  });
}

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

type ModuleQueueGroupProps = {
  children: ReactNode;
  itemCount: number;
  moduleCount: number;
  moduleId: string;
  moduleName: string;
  position: number;
  sessionId: string;
  stagedCreateOperationId?: string | null;
  stagedDeleteOperationId?: string | null;
  stagedName?: string | null;
  stagedRenameOperationId?: string | null;
};

export default function ModuleQueueGroup({
  children,
  itemCount,
  moduleCount,
  moduleId,
  moduleName,
  position,
  sessionId,
  stagedCreateOperationId,
  stagedDeleteOperationId,
  stagedName,
  stagedRenameOperationId,
}: ModuleQueueGroupProps) {
  const router = useRouter();
  const storageKey = `canvascurate:collapsed-modules:${sessionId}`;
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState(stagedName ?? moduleName);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollapsed(readCollapsedIds(storageKey).includes(moduleId));
    }, 0);

    function handleCollapseUpdated(event: Event) {
      const detail = (event as CustomEvent<{ storageKey?: string; collapsedIds?: string[] }>).detail;
      if (detail?.storageKey !== storageKey) return;
      setCollapsed(Boolean(detail.collapsedIds?.includes(moduleId)));
    }

    window.addEventListener("canvascurate:module-collapse-updated", handleCollapseUpdated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("canvascurate:module-collapse-updated", handleCollapseUpdated);
    };
  }, [moduleId, storageKey]);

  function toggleCollapsed() {
    const collapsedIds = new Set(readCollapsedIds(storageKey));
    const next = !collapsedIds.has(moduleId);
    if (next) {
      collapsedIds.add(moduleId);
    } else {
      collapsedIds.delete(moduleId);
    }
    const nextIds = [...collapsedIds];
    window.localStorage.setItem(storageKey, JSON.stringify(nextIds));
    setCollapsed(next);
    notifyCollapseUpdated(storageKey, nextIds);
  }

  async function stageModulePosition(nextPosition: number) {
    setBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-level-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "module_position",
          module_id: moduleId,
          after_state: { position: nextPosition },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage module move"));
      }
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  async function stageModuleRename(nextName: string) {
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    setBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-level-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "module_rename",
          module_id: moduleId,
          after_state: { name: trimmedName },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage module rename"));
      }
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
      setRenameOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  async function stageModuleDelete() {
    setBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-level-operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_type: "module_delete",
          module_id: moduleId,
          after_state: { deleted: true },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to stage module delete"));
      }
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
      setDeleteOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  return (
    <div
      className={`border-b border-outline-variant/20 py-2 ${stagedDeleteOperationId ? "bg-error/5 opacity-75" : ""}`}
      data-queue-group
      data-allow-empty="true"
      data-search-text={moduleName}
    >
      <div className={`relative flex items-center gap-1 px-5 py-2 transition-colors ${stagedDeleteOperationId ? "hover:bg-error/10" : "hover:bg-surface-container-low/60"}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          aria-expanded={!collapsed}
          title={moduleName}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-3 text-xs font-bold text-on-surface-variant" aria-hidden>
              {collapsed ? ">" : "v"}
            </span>
            <span className="line-clamp-1 text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant" title={moduleName}>
              {moduleName}
            </span>
            {stagedCreateOperationId ? <Badge variant="primary" className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]">New</Badge> : null}
            {stagedDeleteOperationId ? <Badge variant="error" className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]">Delete</Badge> : null}
            {stagedRenameOperationId ? <Badge variant="warning" className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]">Renamed</Badge> : null}
          </span>
          <span className="text-[11px] font-semibold text-on-surface-variant">
            {itemCount}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMenuOpen((current) => !current)}
          className={`h-7 border bg-white px-2 text-xs font-semibold ${
            error ? "border-error/40 text-error" : "border-outline-variant/40 text-on-surface-variant"
          }`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Module actions"
          title="Module actions"
        >
          Actions
        </Button>
        {menuOpen ? (
          <div
            className="absolute right-5 top-9 z-20 w-44 overflow-hidden rounded-lg border border-outline-variant/30 bg-white py-1 text-sm shadow-lg"
            role="menu"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || Boolean(stagedDeleteOperationId)}
              onClick={() => {
                setRenameName(stagedName ?? moduleName);
                setRenameOpen(true);
                setMenuOpen(false);
              }}
              className="h-auto w-full justify-start rounded-none border-0 px-3 py-2 text-on-surface hover:bg-surface-container-low"
              role="menuitem"
            >
              Rename Module
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || Boolean(stagedDeleteOperationId) || position <= 1}
              onClick={() => void stageModulePosition(1)}
              className="h-auto w-full justify-start rounded-none border-0 px-3 py-2 text-on-surface hover:bg-surface-container-low"
              role="menuitem"
            >
              Move module to top
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || Boolean(stagedDeleteOperationId) || position >= moduleCount}
              onClick={() => void stageModulePosition(moduleCount)}
              className="h-auto w-full justify-start rounded-none border-0 px-3 py-2 text-on-surface hover:bg-surface-container-low"
              role="menuitem"
            >
              Move module to bottom
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || Boolean(stagedDeleteOperationId)}
              onClick={() => {
                setDeleteOpen(true);
                setMenuOpen(false);
              }}
              className="h-auto w-full justify-start rounded-none border-0 px-3 py-2 text-error hover:bg-error/10"
              role="menuitem"
            >
              Delete Module
            </Button>
          </div>
        ) : null}
      </div>
      {!collapsed ? children : null}
      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Module"
        subtitle="Pending Review"
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-on-surface-variant">
            This removes the module shell and item placements. The underlying pages, assignments, and discussions remain in the course.
          </p>
            <div className="mt-4 rounded-lg bg-error/5 px-3 py-3 text-sm text-on-surface">
              <p className="font-semibold">{moduleName}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {itemCount} module item{itemCount === 1 ? "" : "s"} will be removed from the module structure.
              </p>
            </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" loading={busy} onClick={() => void stageModuleDelete()}>
            Delete Module
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename Module"
        subtitle="Pending Review"
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-on-surface-variant">Stage a new module name for pending review.</p>
          <Input
            id={`module-name-${moduleId}`}
            label="Module name"
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void stageModuleRename(renameName);
              }
              if (event.key === "Escape") {
                setRenameOpen(false);
              }
            }}
            className="bg-white"
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
            Cancel
          </Button>
          <Button type="button" loading={busy} disabled={!renameName.trim()} onClick={() => void stageModuleRename(renameName)}>
            Rename
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
