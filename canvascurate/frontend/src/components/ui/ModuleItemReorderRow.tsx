"use client";

import { type CSSProperties, type DragEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

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

type DropSide = "before" | "after" | null;

type ModuleItemReorderRowProps = {
  children: ReactNode;
  className: string;
  moduleCanvasId: string;
  moduleId: string;
  moduleItemId: string;
  moveDownPosition?: number | null;
  moveUpPosition?: number | null;
  searchText: string;
  sessionId: string;
  stagedModuleOperationType?: "item_position" | "item_move";
  style?: CSSProperties;
};

type PositionChange = {
  moduleItemId: string;
  operationType?: "item_position" | "item_move";
  position: number;
  targetModuleId?: string;
};

export default function ModuleItemReorderRow({
  children,
  className,
  moduleCanvasId,
  moduleId,
  moduleItemId,
  moveDownPosition,
  moveUpPosition,
  searchText,
  sessionId,
  stagedModuleOperationType = "item_position",
  style,
}: ModuleItemReorderRowProps) {
  const router = useRouter();
  const [dropSide, setDropSide] = useState<DropSide>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function updateDropSide(event: DragEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setDropSide(side);
  }

  async function stagePositionChanges(changes: PositionChange[]) {
    if (changes.length === 0) return;
    setBusy(true);
    setError(false);
    try {
      const token = await getAccessToken();
      for (const change of changes) {
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            operation_type: change.operationType ?? "item_position",
            module_item_id: change.moduleItemId,
            after_state: {
              position: change.position,
              ...(change.operationType === "item_move" ? { module_id: change.targetModuleId } : {}),
            },
          }),
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to stage reorder"));
        }
      }
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function moduleOrderAfterDrop(sourceId: string, targetId: string, side: Exclude<DropSide, null>) {
    const sourceModuleId = window.sessionStorage.getItem("canvascurate:drag-module-id") ?? moduleId;
    const sourceGroup = document.querySelector<HTMLElement>(`[data-module-reorder-group="${sourceModuleId}"]`);
    const targetGroup = document.querySelector<HTMLElement>(`[data-module-reorder-group="${moduleId}"]`);
    const sourceRows = Array.from(sourceGroup?.querySelectorAll<HTMLElement>("[data-module-item-id]") ?? []);
    const targetRows = Array.from(targetGroup?.querySelectorAll<HTMLElement>("[data-module-item-id]") ?? []);
    const sourceOrder = sourceRows
      .map((row) => row.dataset.moduleItemId)
      .filter((id): id is string => Boolean(id));
    const targetOrder = targetRows
      .map((row) => row.dataset.moduleItemId)
      .filter((id): id is string => Boolean(id));

    if (sourceModuleId !== moduleId) {
      if (!sourceOrder.includes(sourceId) || !targetOrder.includes(targetId)) return [];
      const nextSourceOrder = sourceOrder.filter((id) => id !== sourceId);
      const nextTargetOrder = targetOrder.filter((id) => id !== sourceId);
      const targetIndex = nextTargetOrder.indexOf(targetId);
      if (targetIndex === -1) return [];
      nextTargetOrder.splice(side === "before" ? targetIndex : targetIndex + 1, 0, sourceId);

      const sourceChanges = nextSourceOrder
        .map((id, index) => ({ moduleItemId: id, position: index + 1 }))
        .filter((change, index) => sourceOrder[index] !== change.moduleItemId);
      const targetChanges = nextTargetOrder
        .map((id, index) => ({
          moduleItemId: id,
          operationType: id === sourceId ? "item_move" as const : "item_position" as const,
          position: index + 1,
          targetModuleId: id === sourceId ? moduleId : undefined,
        }))
        .filter((change, index) => targetOrder[index] !== change.moduleItemId);
      return [...sourceChanges, ...targetChanges];
    }

    const currentOrder = targetOrder;
    const sourceIndex = currentOrder.indexOf(sourceId);
    const targetIndex = currentOrder.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) return [];

    const nextOrder = [...currentOrder];
    nextOrder.splice(sourceIndex, 1);
    const adjustedTargetIndex = nextOrder.indexOf(targetId);
    if (adjustedTargetIndex === -1) return [];
    nextOrder.splice(side === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1, 0, sourceId);

    return nextOrder
      .map((id, index) => {
        const row = targetRows.find((candidate) => candidate.dataset.moduleItemId === id);
        const operationType = row?.dataset.moduleOperationType === "item_move" ? "item_move" : "item_position";
        return {
          moduleItemId: id,
          operationType,
          position: index + 1,
          targetModuleId: operationType === "item_move" ? moduleId : undefined,
        };
      })
      .filter((change, index) => currentOrder[index] !== change.moduleItemId);
  }

  return (
    <div
      className={`${className} relative ${dropSide ? "bg-secondary-container/10" : ""}`}
      data-queue-item
      data-module-canvas-id={moduleCanvasId}
      data-module-item-id={moduleItemId}
      data-module-operation-type={stagedModuleOperationType}
      data-search-text={searchText}
      onDragOver={(event) => {
        event.preventDefault();
        updateDropSide(event);
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData("application/x-canvascurate-module-item-id");
        const side = dropSide;
        setDropSide(null);
        if (!sourceId || sourceId === moduleItemId || !side) return;

        void stagePositionChanges(moduleOrderAfterDrop(sourceId, moduleItemId, side));
      }}
      style={style}
    >
      {dropSide ? (
        <div
          className={`absolute left-4 right-4 h-0.5 rounded-full bg-secondary-container ${
            dropSide === "before" ? "top-0" : "bottom-0"
          }`}
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        draggable
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && moveUpPosition) {
            event.preventDefault();
            event.stopPropagation();
            void stagePositionChanges([{
              moduleItemId,
              operationType: stagedModuleOperationType,
              position: moveUpPosition,
              targetModuleId: stagedModuleOperationType === "item_move" ? moduleId : undefined,
            }]);
          }
          if (event.key === "ArrowDown" && moveDownPosition) {
            event.preventDefault();
            event.stopPropagation();
            void stagePositionChanges([{
              moduleItemId,
              operationType: stagedModuleOperationType,
              position: moveDownPosition,
              targetModuleId: stagedModuleOperationType === "item_move" ? moduleId : undefined,
            }]);
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-canvascurate-module-item-id", moduleItemId);
          event.dataTransfer.setData("application/x-canvascurate-module-id", moduleId);
          window.sessionStorage.setItem("canvascurate:drag-module-id", moduleId);
        }}
        onDragEnd={() => {
          window.sessionStorage.removeItem("canvascurate:drag-module-id");
        }}
        className={`mt-0.5 flex h-6 w-5 flex-none cursor-grab items-center justify-center rounded text-sm font-bold text-on-surface-variant/55 transition-colors hover:bg-surface-container-high hover:text-on-surface active:cursor-grabbing ${
          error ? "text-error" : ""
        } ${busy ? "opacity-50" : ""}`}
        title="Drag to reorder. Use arrow keys while focused to stage a move."
        aria-label="Drag to reorder module item. Use Arrow Up or Arrow Down while focused to stage a move."
      >
        ⋮⋮
      </button>
      {children}
    </div>
  );
}
