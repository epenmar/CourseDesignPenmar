import Link from "next/link";
import { notFound } from "next/navigation";

import ContentEditorWorkspace from "@/modules/editor/components/ContentEditorWorkspace";
import CreateContentItemButton from "@/components/ui/CreateContentItemButton";
import CreateModuleButton from "@/components/ui/CreateModuleButton";
import LiveQueueSearch from "@/components/ui/LiveQueueSearch";
import ModuleCollapseAllButton from "@/components/ui/ModuleCollapseAllButton";
import ModuleItemReorderRow from "@/components/ui/ModuleItemReorderRow";
import ModuleQueueGroup from "@/components/ui/ModuleQueueGroup";
import ModuleItemStageActions from "@/components/ui/ModuleItemStageActions";
import { createClient } from "@/lib/supabase/server";

const EDIT_TYPES = ["all", "page", "assignment", "discussion", "quiz"] as const;
const QUEUE_VIEWS = ["module", "type", "smart"] as const;

type EditType = typeof EDIT_TYPES[number];
type QueueView = typeof QUEUE_VIEWS[number];

type EditSearchParams = {
  item?: string;
  view?: string;
  type?: string;
  q?: string;
  queue?: string;
};

type ContentListRow = {
  id: string;
  title: string | null;
  content_type: Exclude<EditType, "all">;
  canvas_url: string | null;
  published: boolean | null;
  module_name: string | null;
  is_orphaned: boolean;
  updated_at: string;
};

type ModuleRow = {
  id: string;
  canvas_module_id: string;
  name: string;
  position: number | null;
  published: boolean | null;
  items_count: number | null;
};

type ModuleItemRow = {
  id: string;
  module_id: string;
  content_item_id: string | null;
  canvas_module_id: string;
  title: string | null;
  module_item_type: string | null;
  content_type: string | null;
  position: number | null;
  indent: number;
  published: boolean | null;
};

type ModuleOperationRow = {
  id: string;
  module_id: string | null;
  module_item_id: string | null;
  content_item_id: string | null;
  operation_type: string;
  before_state: { module_id?: string; canvas_module_id?: string; module_name?: string; name?: string; title?: string; position?: number; items_count?: number } | null;
  after_state: { deleted?: boolean; module_id?: string; canvas_module_id?: string; module_name?: string; name?: string; title?: string; published?: boolean; indent?: number; position?: number } | null;
};

function filterHref(
  sessionId: string,
  {
    view,
    type,
    itemId,
    query,
    queueHidden,
  }: {
    view: QueueView;
    type: EditType;
    itemId?: string;
    query?: string;
    queueHidden?: boolean;
  },
) {
  const params = new URLSearchParams();
  if (view !== "module") params.set("view", view);
  if (type !== "all") params.set("type", type);
  if (query?.trim()) params.set("q", query.trim());
  if (queueHidden) params.set("queue", "hidden");
  if (itemId) params.set("item", itemId);
  const suffix = params.toString();
  return `/sessions/${sessionId}/edit${suffix ? `?${suffix}` : ""}`;
}

function sortByEffectiveModulePosition<T extends { id: string; position: number | null; title?: string | null }>(
  rows: T[],
  stagedPositionByModuleItemId: Map<string, ModuleOperationRow>,
) {
  return [...rows].sort((a, b) => {
    const aOperation = stagedPositionByModuleItemId.get(a.id);
    const bOperation = stagedPositionByModuleItemId.get(b.id);
    const aPosition = aOperation?.after_state?.position ?? a.position ?? Number.MAX_SAFE_INTEGER;
    const bPosition = bOperation?.after_state?.position ?? b.position ?? Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) return aPosition - bPosition;

    if (aOperation && !bOperation) {
      const before = aOperation.before_state?.position ?? a.position ?? aPosition;
      return aPosition > before ? 1 : -1;
    }
    if (!aOperation && bOperation) {
      const before = bOperation.before_state?.position ?? b.position ?? bPosition;
      return bPosition > before ? -1 : 1;
    }

    return (a.title || "").localeCompare(b.title || "");
  });
}

function sortModulesByEffectivePosition(
  rows: ModuleRow[],
  stagedPositionByModuleId: Map<string, ModuleOperationRow>,
) {
  return [...rows].sort((a, b) => {
    const aOperation = stagedPositionByModuleId.get(a.id);
    const bOperation = stagedPositionByModuleId.get(b.id);
    const aPosition = aOperation?.after_state?.position ?? a.position ?? Number.MAX_SAFE_INTEGER;
    const bPosition = bOperation?.after_state?.position ?? b.position ?? Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) return aPosition - bPosition;

    if (aOperation && !bOperation) {
      const before = aOperation.before_state?.position ?? a.position ?? aPosition;
      return aPosition > before ? 1 : -1;
    }
    if (!aOperation && bOperation) {
      const before = bOperation.before_state?.position ?? b.position ?? bPosition;
      return bPosition > before ? -1 : 1;
    }

    return (a.name || "").localeCompare(b.name || "");
  });
}

function effectiveModuleName(
  module: ModuleRow,
  stagedRenameByModuleId: Map<string, ModuleOperationRow>,
) {
  return stagedRenameByModuleId.get(module.id)?.after_state?.name ?? module.name;
}

function effectiveModulePosition(
  moduleItem: { id: string; position: number | null },
  stagedPositionByModuleItemId: Map<string, ModuleOperationRow>,
) {
  return stagedPositionByModuleItemId.get(moduleItem.id)?.after_state?.position
    ?? moduleItem.position
    ?? Number.MAX_SAFE_INTEGER;
}

function nearestModuleContentItemIdAfterRemoval(
  moduleRows: ModuleRow[],
  moduleItemsByModule: Map<string, ModuleItemRow[]>,
  stagedPositionByModuleItemId: Map<string, ModuleOperationRow>,
  stagedRemoveByModuleItemId: Map<string, ModuleOperationRow>,
  stagedDeleteByModuleId: Map<string, ModuleOperationRow>,
  selectedItemId: string | null | undefined,
  filteredEditableIds: Set<string>,
) {
  if (!selectedItemId) return null;
  const flattened = moduleRows.flatMap((module) => (
    sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId)
      .filter((moduleItem) => moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id))
      .map((moduleItem) => ({ ...moduleItem, effective_module_id: module.id }))
  ));
  const selectedIndex = flattened.findIndex((moduleItem) => (
    moduleItem.content_item_id === selectedItemId
      && (stagedRemoveByModuleItemId.has(moduleItem.id) || stagedDeleteByModuleId.has(moduleItem.effective_module_id))
  ));
  if (selectedIndex === -1) return null;

  for (let index = selectedIndex + 1; index < flattened.length; index += 1) {
    const candidate = flattened[index];
    if (
      candidate.content_item_id
      && !stagedRemoveByModuleItemId.has(candidate.id)
      && !stagedDeleteByModuleId.has(candidate.effective_module_id)
    ) {
      return candidate.content_item_id;
    }
  }
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const candidate = flattened[index];
    if (
      candidate.content_item_id
      && !stagedRemoveByModuleItemId.has(candidate.id)
      && !stagedDeleteByModuleId.has(candidate.effective_module_id)
    ) {
      return candidate.content_item_id;
    }
  }
  return null;
}

function titleForType(type: string | null) {
  if (!type) return "Item";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function filterLabel(type: EditType) {
  if (type === "all") return "All";
  if (type === "page") return "Pages";
  if (type === "assignment") return "Assign";
  if (type === "discussion") return "Discuss";
  return "Quiz";
}

function queueSearchText(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLowerCase();
}

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<EditSearchParams>;
}) {
  const { id } = await params;
  const {
    type = "all",
    view = "module",
    item: requestedItemId,
    q = "",
    queue = "visible",
  } = await searchParams;
  const selectedType = EDIT_TYPES.includes(type as EditType) ? (type as EditType) : "all";
  const selectedView = QUEUE_VIEWS.includes(view as QueueView) ? (view as QueueView) : "module";
  const searchQuery = q.trim();
  const normalizedSearch = searchQuery.toLowerCase();
  const queueHidden = queue === "hidden";
  const queueContainerId = `content-queue-${id}`;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, name, source_course_id")
    .eq("id", id)
    .single();

  if (!session) notFound();

  const itemsQuery = supabase
    .from("course_content_items")
    .select("id, title, content_type, canvas_url, published, module_name, is_orphaned, updated_at")
    .eq("session_id", id)
    .in("content_type", ["page", "assignment", "discussion", "quiz"])
    .order("title", { ascending: true });

  const [{ data: items }, { data: modules }, { data: moduleItems }, { data: moduleOperations }, { data: course }] = await Promise.all([
    itemsQuery,
    supabase
      .from("course_modules")
      .select("id, canvas_module_id, name, position, published, items_count")
      .eq("session_id", id),
    supabase
      .from("course_module_items")
      .select("id, module_id, content_item_id, canvas_module_id, title, module_item_type, content_type, position, indent, published")
      .eq("session_id", id),
    supabase
      .from("module_queue_operations")
      .select("id, module_id, module_item_id, content_item_id, operation_type, before_state, after_state")
      .eq("session_id", id)
      .eq("status", "staged"),
    session.source_course_id
      ? supabase
          .from("courses")
          .select("canvas_base_url, canvas_course_id")
          .eq("id", session.source_course_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const rows = (items ?? []) as ContentListRow[];
  const typeFilteredRows = rows.filter((row) => selectedType === "all" || row.content_type === selectedType);
  const filteredRows = typeFilteredRows.filter((row) => {
    const haystack = `${row.title || ""} ${row.module_name || ""} ${row.content_type}`.toLowerCase();
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    return matchesSearch;
  });
  const contentById = new Map(rows.map((row) => [row.id, row]));
  const stagedPublishByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && operation.operation_type === "item_publish")
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedIndentByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && operation.operation_type === "item_indent")
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedRenameByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && operation.operation_type === "item_rename")
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedPositionByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && ["item_position", "item_move"].includes(operation.operation_type))
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedRemoveByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && operation.operation_type === "item_remove")
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedMoveByModuleItemId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_item_id && operation.operation_type === "item_move")
      .map((operation) => [operation.module_item_id as string, operation]),
  );
  const stagedPositionByModuleId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_id && operation.operation_type === "module_position")
      .map((operation) => [operation.module_id as string, operation]),
  );
  const stagedRenameByModuleId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_id && operation.operation_type === "module_rename")
      .map((operation) => [operation.module_id as string, operation]),
  );
  const stagedDeleteByModuleId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_id && operation.operation_type === "module_delete")
      .map((operation) => [operation.module_id as string, operation]),
  );
  const stagedCreateByModuleId = new Map(
    ((moduleOperations ?? []) as ModuleOperationRow[])
      .filter((operation) => operation.module_id && operation.operation_type === "module_create")
      .map((operation) => [operation.module_id as string, operation]),
  );
  const filteredEditableIds = new Set(filteredRows.map((row) => row.id));
  const typeFilteredEditableIds = new Set(typeFilteredRows.map((row) => row.id));
  const moduleRows = sortModulesByEffectivePosition((modules ?? []) as ModuleRow[], stagedPositionByModuleId);
  const moduleItemsByModule = new Map<string, ModuleItemRow[]>();
  for (const item of ((moduleItems ?? []) as ModuleItemRow[])) {
    const stagedMove = stagedMoveByModuleItemId.get(item.id);
    const effectiveModuleId = stagedMove?.after_state?.module_id ?? item.module_id;
    const existing = moduleItemsByModule.get(effectiveModuleId) ?? [];
    existing.push({
      ...item,
      module_id: effectiveModuleId,
      canvas_module_id: stagedMove?.after_state?.canvas_module_id ?? item.canvas_module_id,
    });
    moduleItemsByModule.set(effectiveModuleId, existing);
  }

  const typeRows = filteredRows
    .sort((a, b) => `${a.content_type}:${a.title || ""}`.localeCompare(`${b.content_type}:${b.title || ""}`));
  const allTypeRows = typeFilteredRows
    .sort((a, b) => `${a.content_type}:${a.title || ""}`.localeCompare(`${b.content_type}:${b.title || ""}`));
  const smartRows = filteredRows
    .filter((row) => row.is_orphaned || !row.module_name)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const allSmartRows = typeFilteredRows
    .filter((row) => row.is_orphaned || !row.module_name)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const moduleFilteredCount = moduleRows.reduce((count, module) => {
    const moduleQueueItems = sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId)
      .filter((moduleItem) => moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id));
    return count + moduleQueueItems.length;
  }, 0);
  const moduleTypeFilteredCount = moduleRows.reduce((count, module) => {
    const moduleQueueItems = sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId)
      .filter((moduleItem) => moduleItem.content_item_id && typeFilteredEditableIds.has(moduleItem.content_item_id));
    return count + moduleQueueItems.length;
  }, 0);
  const queueVisibleCount = selectedView === "module"
    ? moduleFilteredCount
    : selectedView === "smart"
      ? smartRows.length
      : typeRows.length;
  const queueTotalCount = selectedView === "module"
    ? moduleTypeFilteredCount
    : selectedView === "smart"
      ? allSmartRows.length
      : allTypeRows.length;
  const moduleActionTargets = moduleRows.map((module) => ({
    id: module.id,
    name: effectiveModuleName(module, stagedRenameByModuleId),
    itemCount: (moduleItemsByModule.get(module.id) ?? [])
      .filter((moduleItem) => !stagedRemoveByModuleItemId.has(moduleItem.id))
      .length,
  }));
  const fallbackFirstItemId = moduleRows
    .flatMap((module) => sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId))
    .find((moduleItem) => moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id))
    ?.content_item_id ?? typeRows[0]?.id;
  const visibleModuleIds = moduleRows
    .filter((module) => {
      const moduleName = effectiveModuleName(module, stagedRenameByModuleId);
      const hasVisibleItems = sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId)
        .some((moduleItem) => moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id));
      const moduleMatchesSearch = !normalizedSearch || moduleName.toLowerCase().includes(normalizedSearch);
      return hasVisibleItems || Boolean(stagedCreateByModuleId.get(module.id)) || (selectedType === "all" && moduleMatchesSearch);
    })
    .map((module) => module.id);
  const selectedItemId = requestedItemId && rows.some((row) => row.id === requestedItemId)
    ? requestedItemId
    : fallbackFirstItemId;
  const selectedRemovalOperation = selectedItemId
    ? [...stagedRemoveByModuleItemId.values()].find((operation) => operation.content_item_id === selectedItemId)
    : null;
  const selectedModuleDeleteOperation = selectedItemId
    ? [...moduleItemsByModule.entries()].flatMap(([moduleId, itemsInModule]) => (
        itemsInModule.map((moduleItem) => ({ moduleId, moduleItem, operation: stagedDeleteByModuleId.get(moduleId) }))
      )).find(({ moduleId, moduleItem }) => (
        moduleItem.content_item_id === selectedItemId && stagedDeleteByModuleId.has(moduleId)
      ))
    : null;
  const removalRedirectItemId = nearestModuleContentItemIdAfterRemoval(
    moduleRows,
    moduleItemsByModule,
    stagedPositionByModuleItemId,
    stagedRemoveByModuleItemId,
    stagedDeleteByModuleId,
    selectedItemId,
    filteredEditableIds,
  );
  const removalRedirectHref = removalRedirectItemId
    ? filterHref(id, {
        view: selectedView,
        type: selectedType,
        itemId: removalRedirectItemId,
        query: searchQuery,
        queueHidden,
      })
    : filterHref(id, {
        view: selectedView,
        type: selectedType,
        query: searchQuery,
        queueHidden,
      });

  const selectedItem = rows.find((row) => row.id === selectedItemId) ?? null;
  const { data: body } = selectedItem
    ? await supabase
        .from("course_content_bodies")
        .select("html_body, plain_text")
        .eq("content_item_id", selectedItem.id)
        .single()
    : { data: null };

  const baseHref = course?.canvas_base_url && course?.canvas_course_id
    ? `${course.canvas_base_url.replace(/\/$/, "")}/courses/${course.canvas_course_id}/`
    : "";

  return (
    <div className={`grid h-[calc(100vh-7rem)] min-h-[680px] gap-5 overflow-hidden ${queueHidden ? "grid-cols-1" : "xl:grid-cols-[320px_minmax(0,1fr)]"}`}>
      {!queueHidden ? (
        <aside
          id={queueContainerId}
          className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm"
        >
          <div className="border-b border-outline-variant/30 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Content Queue
                </p>
                <p className="mt-1 text-xs text-on-surface-variant" data-queue-count>
                  {queueVisibleCount} of {queueTotalCount} editable items
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <CreateModuleButton moduleCount={moduleRows.length} sessionId={id} />
                <CreateContentItemButton
                  sessionId={id}
                  modules={moduleRows.map((module) => ({
                    id: module.id,
                    name: effectiveModuleName(module, stagedRenameByModuleId),
                  }))}
                />
                <Link
                  href={filterHref(id, {
                    view: selectedView,
                    type: selectedType,
                    itemId: selectedItemId,
                    query: searchQuery,
                    queueHidden: true,
                  })}
                  className="inline-flex h-9 items-center rounded-lg bg-surface-container-low px-2.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  Hide
                </Link>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1 border-b border-outline-variant/30 px-3 py-3">
            {EDIT_TYPES.map((filter) => (
              <Link
                key={filter}
                href={filterHref(id, {
                  view: selectedView,
                  type: filter,
                  itemId: selectedItemId,
                  query: searchQuery,
                })}
                className={`rounded-lg px-1.5 py-2 text-center text-xs font-semibold transition-colors ${
                  selectedType === filter
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {filterLabel(filter)}
              </Link>
            ))}
          </div>
          <LiveQueueSearch containerId={queueContainerId} initialQuery={searchQuery} totalCount={queueTotalCount} />
          <div className="flex flex-wrap gap-1 border-b border-outline-variant/30 px-3 py-3">
            {QUEUE_VIEWS.map((queueView) => (
              <Link
                key={queueView}
                href={filterHref(id, {
                  view: queueView,
                  type: selectedType,
                  query: searchQuery,
                })}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  selectedView === queueView
                    ? "bg-primary text-on-primary"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {queueView === "module" ? "By Module" : queueView === "type" ? "By Type" : "Smart"}
              </Link>
            ))}
            {selectedView === "module" ? (
              <ModuleCollapseAllButton moduleIds={visibleModuleIds} sessionId={id} />
            ) : null}
          </div>
          {filteredRows.length === 0 && selectedView !== "module" ? (
            <div className="px-5 py-10 text-sm text-on-surface-variant">
              No editable content matched this filter.
            </div>
          ) : selectedView === "module" ? (
            <div className="min-h-0 flex-1 overflow-y-auto py-2" data-queue-list>
              {moduleRows.length === 0 ? (
                <div className="px-5 py-10 text-sm text-on-surface-variant">
                  Run a Canvas sync to load module structure.
                </div>
              ) : (
                moduleRows.map((module) => {
                  const stagedModulePosition = stagedPositionByModuleId.get(module.id)?.after_state?.position;
                  const stagedModuleCreate = stagedCreateByModuleId.get(module.id);
                  const stagedModuleRename = stagedRenameByModuleId.get(module.id);
                  const stagedModuleDelete = stagedDeleteByModuleId.get(module.id);
                  const moduleName = effectiveModuleName(module, stagedRenameByModuleId);
                  const moduleQueueItems = sortByEffectiveModulePosition(moduleItemsByModule.get(module.id) ?? [], stagedPositionByModuleItemId)
                    .filter((moduleItem) => moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id));
                  const moduleMatchesSearch = !normalizedSearch || moduleName.toLowerCase().includes(normalizedSearch);
                  if (moduleQueueItems.length === 0 && !stagedModuleCreate && (selectedType !== "all" || !moduleMatchesSearch)) return null;
                  return (
                    <ModuleQueueGroup
                      key={module.id}
                      sessionId={id}
                      moduleId={module.id}
                      moduleName={moduleName}
                      moduleCount={moduleRows.length}
                      position={stagedModulePosition ?? module.position ?? moduleRows.length}
                      itemCount={module.items_count ?? moduleQueueItems.length}
                      stagedCreateOperationId={stagedModuleCreate?.id ?? null}
                      stagedRenameOperationId={stagedModuleRename?.id ?? null}
                      stagedName={stagedModuleRename?.after_state?.name ?? null}
                      stagedDeleteOperationId={stagedModuleDelete?.id ?? null}
                    >
                      <div data-module-reorder-group={module.id}>
                        {moduleQueueItems.length === 0 ? (
                          <div className="px-5 py-3 text-xs text-on-surface-variant">
                            No editable items in this module yet.
                          </div>
                        ) : null}
                        {moduleQueueItems.map((moduleItem, moduleItemIndex) => {
                          const linkedItem = moduleItem.content_item_id ? contentById.get(moduleItem.content_item_id) : null;
                          const previousModuleItem = moduleItemIndex > 0 ? moduleQueueItems[moduleItemIndex - 1] : null;
                          const nextModuleItem = moduleItemIndex < moduleQueueItems.length - 1 ? moduleQueueItems[moduleItemIndex + 1] : null;
                          const active = moduleItem.content_item_id === selectedItemId;
                          const stagedRename = stagedRenameByModuleItemId.get(moduleItem.id);
                          const label = stagedRename?.after_state?.title || moduleItem.title || linkedItem?.title || "Untitled item";
                          const typeLabel = titleForType(moduleItem.content_type || moduleItem.module_item_type);
                          const isEditable = Boolean(moduleItem.content_item_id && filteredEditableIds.has(moduleItem.content_item_id));
                          const stagedRemoveOperationId = stagedRemoveByModuleItemId.get(moduleItem.id)?.id ?? null;

                          if (!isEditable || !moduleItem.content_item_id) {
                            return (
                              <div
                                key={moduleItem.id}
                                className="px-5 py-2 text-sm text-on-surface-variant/70"
                              >
                                <p className="line-clamp-1">{label}</p>
                                <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em]">{typeLabel}</p>
                              </div>
                            );
                          }

                          return (
                            <ModuleItemReorderRow
                              key={moduleItem.id}
                              sessionId={id}
                              moduleId={module.id}
                              moduleCanvasId={module.canvas_module_id}
                              moduleItemId={moduleItem.id}
                              moveUpPosition={previousModuleItem ? effectiveModulePosition(previousModuleItem, stagedPositionByModuleItemId) : null}
                              moveDownPosition={nextModuleItem ? effectiveModulePosition(nextModuleItem, stagedPositionByModuleItemId) : null}
                              searchText={queueSearchText(label, linkedItem?.module_name, moduleName, moduleItem.content_type, moduleItem.module_item_type)}
                              stagedModuleOperationType={stagedMoveByModuleItemId.has(moduleItem.id) ? "item_move" : "item_position"}
                              className={`flex items-start gap-2 px-5 py-2 transition-colors ${
                                stagedRemoveOperationId
                                  ? "bg-error/5 opacity-70"
                                  : active
                                    ? "bg-surface-container-low"
                                    : "hover:bg-surface-container-low/60"
                              }`}
                            >
                              <Link
                                href={filterHref(id, {
                                  view: "module",
                                  type: selectedType,
                                  itemId: moduleItem.content_item_id,
                                  query: searchQuery,
                                })}
                                className="min-w-0 flex-1"
                              >
                                  <p className="line-clamp-2 text-sm font-semibold text-on-surface">{label}</p>
                                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-on-surface-variant">
                                    {typeLabel}
                                  </p>
                              </Link>
                              <ModuleItemStageActions
                                sessionId={id}
                                moduleItemId={moduleItem.id}
                                currentModuleId={module.id}
                                modules={moduleActionTargets}
                                published={moduleItem.published}
                                indent={moduleItem.indent}
                                title={label}
                                stagedOperationId={stagedPublishByModuleItemId.get(moduleItem.id)?.id ?? null}
                                stagedPublished={stagedPublishByModuleItemId.get(moduleItem.id)?.after_state?.published ?? null}
                                stagedIndentOperationId={stagedIndentByModuleItemId.get(moduleItem.id)?.id ?? null}
                                stagedIndent={stagedIndentByModuleItemId.get(moduleItem.id)?.after_state?.indent ?? null}
                                stagedRemoveOperationId={stagedRemoveOperationId}
                                stagedRenameOperationId={stagedRename?.id ?? null}
                                stagedTitle={stagedRename?.after_state?.title ?? null}
                              />
                            </ModuleItemReorderRow>
                          );
                        })}
                      </div>
                    </ModuleQueueGroup>
                  );
                })
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-outline-variant/20 overflow-y-auto" data-queue-list>
              {(selectedView === "smart" ? smartRows : typeRows).map((row) => {
                const href = filterHref(id, {
                  view: selectedView,
                  type: selectedType,
                  itemId: row.id,
                  query: searchQuery,
                });
                const active = row.id === selectedItemId;
                return (
                  <Link
                    key={row.id}
                    href={href}
                    className={`block px-5 py-4 transition-colors ${
                      active ? "bg-surface-container-low" : "hover:bg-surface-container-low/60"
                    }`}
                    data-queue-item
                    data-search-text={queueSearchText(row.title, row.module_name, row.content_type)}
                  >
                    <p className="line-clamp-2 text-sm font-semibold text-on-surface">{row.title || "Untitled content"}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-on-surface-variant">
                      {row.content_type}
                      {row.module_name ? ` · ${row.module_name}` : ""}
                    </p>
                  </Link>
                );
              })}
              {selectedView === "smart" && smartRows.length === 0 ? (
                <div className="px-5 py-10 text-sm text-on-surface-variant">
                  No unplaced editable items found.
                </div>
              ) : null}
            </div>
          )}
          <div className="px-5 py-10 text-sm text-on-surface-variant" data-queue-empty hidden>
            No editable content matched this search.
          </div>
        </aside>
      ) : null}

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
          {queueHidden ? (
            <div className="flex flex-none justify-end border-b border-outline-variant/30 px-4 py-2">
              <Link
                href={filterHref(id, {
                  view: selectedView,
                  type: selectedType,
                  itemId: selectedItemId,
                  query: searchQuery,
                })}
                className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Show queue
              </Link>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
          {selectedItem ? (
            <ContentEditorWorkspace
              key={selectedItem.id}
              sessionId={id}
              item={selectedItem}
              initialTitle={selectedItem.title || ""}
              initialHtml={body?.html_body || ""}
              initialPlainText={body?.plain_text || ""}
              baseHref={baseHref}
              pendingModuleRemoval={Boolean(selectedRemovalOperation)}
              pendingModuleDeletion={Boolean(selectedModuleDeleteOperation)}
              pendingModuleRemovalLabel={
                selectedRemovalOperation?.before_state?.module_name
                ?? (selectedModuleDeleteOperation?.operation?.before_state?.name as string | undefined)
              }
              removalRedirectHref={removalRedirectHref}
            />
          ) : (
            <div className="px-6 py-16 text-center">
              <p className="font-headline text-2xl font-bold text-on-surface">No content selected.</p>
              <p className="mt-2 text-sm text-on-surface-variant">
                Choose a page, assignment, discussion, or quiz from the list to load its saved body.
              </p>
            </div>
          )}
          </div>
        </section>
    </div>
  );
}
