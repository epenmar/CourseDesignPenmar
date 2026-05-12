/**
 * Display helpers for Pending Review components.
 *
 * These helpers are intentionally UI-focused and do not own API behavior.
 */

import type { BatchPushState, PendingModuleChange, PushHistoryItem } from "@/modules/pending_review/types";

export function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatFieldList(fields: string[]) {
  if (!fields.length) return "Content";
  return fields.map((field) => field.replaceAll("_", " ")).join(", ");
}

export function formatModuleValue(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Published" : "Unpublished";
  return String(value);
}

export function statusBadgeClass(status: string) {
  if (status === "ready to push") return "bg-primary/10 text-primary";
  if (status === "needs review") return "bg-secondary-container text-on-secondary-container";
  if (status === "pushed") return "bg-surface-container-high text-on-surface-variant";
  return "bg-surface-container-low text-on-surface-variant";
}

export function batchStatusLabel(state?: BatchPushState) {
  if (!state) return null;
  if (state.status === "queued") return "Queued";
  if (state.status === "pushing") return "Pushing";
  if (state.status === "pushed") return "Pushed";
  return "Failed";
}

export function batchStatusClass(state?: BatchPushState) {
  if (!state) return "";
  if (state.status === "pushed") return "bg-primary/10 text-primary";
  if (state.status === "failed") return "bg-error-container text-error";
  if (state.status === "pushing") return "bg-secondary-container text-on-secondary-container";
  return "bg-surface-container-high text-on-surface-variant";
}

export function moduleOperationToneClass(operationType: string) {
  if (operationType.includes("delete") || operationType.includes("remove")) {
    return "border-error/20 bg-error-container/40";
  }
  if (operationType.includes("create")) {
    return "border-primary/20 bg-primary/5";
  }
  return "border-outline-variant/30 bg-surface-container-low";
}

export function moduleOperationBadgeClass(operationType: string) {
  if (operationType.includes("delete") || operationType.includes("remove")) {
    return "bg-error-container text-error";
  }
  if (operationType === "module_create") {
    return "bg-primary/10 text-primary";
  }
  if (operationType === "item_publish") {
    return "bg-secondary-container text-on-secondary-container";
  }
  return "bg-surface-container-high text-on-surface-variant";
}

export function canApplyModuleOperationIndividually(operationType: string) {
  return operationType === "module_create" || operationType === "module_rename" || operationType === "item_rename";
}

export function moduleOperationCompareRows(change: PendingModuleChange) {
  const before = change.before_state ?? {};
  const after = change.after_state ?? {};

  switch (change.operation_type) {
    case "module_create":
      return [
        { label: "Module", before: "Not in Canvas", after: after.name ?? change.title },
        { label: "Module position", before: "-", after: after.position },
      ];
    case "module_rename":
      return [{ label: "Module name", before: before.name, after: after.name }];
    case "module_position":
      return [{ label: "Module position", before: before.position, after: after.position }];
    case "module_delete":
      return [
        { label: "Module", before: before.name ?? change.title, after: "Deleted" },
        { label: "Module items", before: before.items_count, after: "Removed from module structure" },
      ];
    case "item_rename":
      return [{ label: "Item title", before: before.title ?? change.title, after: after.title }];
    case "item_publish":
      return [{ label: "Status", before: before.published, after: after.published }];
    case "item_indent":
      return [{ label: "Indent", before: before.indent, after: after.indent }];
    case "item_position":
      return [{ label: "Position", before: before.position, after: after.position }];
    case "item_move":
      return [
        { label: "Module", before: before.module_name, after: after.module_name },
        { label: "Position", before: before.position, after: after.position },
      ];
    case "item_remove":
      return [
        { label: "Module", before: before.module_name, after: "Removed" },
        { label: "Position", before: before.position, after: "-" },
      ];
    default:
      return [];
  }
}

export function contentTypeLabel(value: string | null) {
  if (!value) return "Content";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function pushRevisionLabel(historyItem: PushHistoryItem) {
  if (!historyItem.revision_count) return null;
  const noun = historyItem.revision_count === 1 ? "revision" : "revisions";
  if (historyItem.first_revision_number && historyItem.latest_revision_number) {
    if (historyItem.first_revision_number === historyItem.latest_revision_number) {
      return `Revision ${historyItem.latest_revision_number} pushed`;
    }
    return `Revisions ${historyItem.first_revision_number}-${historyItem.latest_revision_number} pushed`;
  }
  return `${historyItem.revision_count} ${noun} pushed`;
}

export function moduleOperationTypeLabel(value?: string) {
  if (!value) return "Module update";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
