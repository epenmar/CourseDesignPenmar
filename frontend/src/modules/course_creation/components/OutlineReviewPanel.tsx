"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, Input } from "@/components/edplus";
import type {
  CourseCreationOutline,
  CourseCreationOutlineItem,
  CourseCreationOutlineModule,
  CourseCreationSourceAnalysisItem,
} from "../types";

const ITEM_TYPES = ["overview", "page", "learningmaterials", "assignment", "discussion", "quiz"];

function cloneOutline(outline: CourseCreationOutline): CourseCreationOutline {
  return JSON.parse(JSON.stringify(outline)) as CourseCreationOutline;
}

function linesToList(value: string) {
  return value.split("\n");
}

function listToLines(value?: string[]) {
  return (value ?? []).join("\n");
}

function sourceLabel(source?: CourseCreationSourceAnalysisItem) {
  if (!source) return "Unknown source";
  const topics = source.topics?.slice(0, 2).join(", ");
  return topics || source.source_title || source.id;
}

function SourcePicker({
  selectedIds,
  sources,
  onChange,
}: {
  selectedIds: string[];
  sources: CourseCreationSourceAnalysisItem[];
  onChange: (nextIds: string[]) => void;
}) {
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const availableSources = sources.filter((source) => !selectedIds.includes(source.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selectedIds.length ? selectedIds.map((sourceId) => {
          const source = sourceMap.get(sourceId);
          return (
            <Badge key={sourceId} className="max-w-full gap-1 rounded-md px-2 py-1 text-[10px]">
              <span className="truncate">{sourceLabel(source)}</span>
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter((id) => id !== sourceId))}
                className="font-bold text-primary"
              >
                Remove
              </button>
            </Badge>
          );
        }) : (
          <span className="text-[11px] text-on-surface-variant">No sources selected.</span>
        )}
      </div>
      <select
        value=""
        onChange={(event) => {
          if (!event.target.value) return;
          onChange([...selectedIds, event.target.value]);
        }}
        className="w-full rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface ghost-border"
      >
        <option value="">Add source chunk...</option>
        {availableSources.map((source) => (
          <option key={source.id} value={source.id}>
            {sourceLabel(source)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function OutlineReviewPanel({
  outline,
  sources,
  saving,
  disabled,
  onSave,
  onDirtyChange,
}: {
  outline: CourseCreationOutline;
  sources: CourseCreationSourceAnalysisItem[];
  saving: boolean;
  disabled: boolean;
  onSave: (outline: CourseCreationOutline) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<CourseCreationOutline>(() => cloneOutline(outline));
  const [savingLocal, setSavingLocal] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(cloneOutline(outline)), 0);
    return () => window.clearTimeout(timer);
  }, [outline]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(outline),
    [draft, outline],
  );

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function updateModule(moduleIndex: number, patch: Partial<CourseCreationOutlineModule>) {
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) => (
        index === moduleIndex ? { ...module, ...patch } : module
      )),
    }));
  }

  function updateItem(moduleIndex: number, itemIndex: number, patch: Partial<CourseCreationOutlineItem>) {
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) => {
        if (index !== moduleIndex) return module;
        const items = module.items ?? [];
        return {
          ...module,
          items: items.map((item, currentItemIndex) => (
            currentItemIndex === itemIndex ? { ...item, ...patch } : item
          )),
        };
      }),
    }));
  }

  function moveModule(moduleIndex: number, direction: -1 | 1) {
    setDraft((current) => {
      const nextIndex = moduleIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.modules.length) return current;
      const modules = [...current.modules];
      [modules[moduleIndex], modules[nextIndex]] = [modules[nextIndex], modules[moduleIndex]];
      return { ...current, modules };
    });
  }

  function moveItem(moduleIndex: number, itemIndex: number, direction: -1 | 1) {
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) => {
        if (index !== moduleIndex) return module;
        const items = [...(module.items ?? [])];
        const nextIndex = itemIndex + direction;
        if (nextIndex < 0 || nextIndex >= items.length) return module;
        [items[itemIndex], items[nextIndex]] = [items[nextIndex], items[itemIndex]];
        return { ...module, items };
      }),
    }));
  }

  async function handleSave() {
    setSavingLocal(true);
    try {
      await onSave(draft);
    } finally {
      setSavingLocal(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-surface-container-low">
        <CardBody>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <Input
              label="Outline Title"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              disabled={disabled}
              className="bg-surface-container-lowest font-bold disabled:opacity-60"
            />
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-on-surface">Description</span>
              <textarea
                value={draft.description ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                disabled={disabled}
                rows={2}
                className="w-full resize-y rounded-lg bg-surface-container-lowest px-3 py-2 text-sm text-on-surface ghost-border disabled:opacity-60"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDraft(cloneOutline(outline))}
              disabled={disabled || !dirty || saving || savingLocal}
              className="text-xs"
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saving || savingLocal}
              onClick={() => void handleSave()}
              disabled={disabled || !dirty || saving || savingLocal}
              className="text-xs"
            >
              Save Reviewed Outline
            </Button>
          </div>
        </div>
        {dirty ? (
          <Alert variant="warning" className="mt-3 py-2 text-xs">
            Save outline changes before creating Canvas Clean drafts.
          </Alert>
        ) : null}
        </CardBody>
      </Card>

      {draft.modules.map((module, moduleIndex) => (
        <Card key={module.id || moduleIndex}>
          <CardBody>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Module {moduleIndex + 1}</p>
              <p className="mt-1 text-xs text-on-surface-variant">{module.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={disabled || moduleIndex === 0} onClick={() => moveModule(moduleIndex, -1)} className="h-auto px-2 py-1 text-[11px]">Up</Button>
              <Button type="button" variant="secondary" size="sm" disabled={disabled || moduleIndex === draft.modules.length - 1} onClick={() => moveModule(moduleIndex, 1)} className="h-auto px-2 py-1 text-[11px]">Down</Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled || draft.modules.length <= 1}
                onClick={() => setDraft((current) => ({ ...current, modules: current.modules.filter((_, index) => index !== moduleIndex) }))}
                className="h-auto px-2 py-1 text-[11px]"
              >
                Remove
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Input
              label="Module Title"
              value={module.title}
              disabled={disabled}
              onChange={(event) => updateModule(moduleIndex, { title: event.target.value })}
              className="bg-surface-container-low disabled:opacity-60"
            />
            <Input
              label="Estimated Workload"
              value={module.estimated_workload ?? ""}
              disabled={disabled}
              onChange={(event) => updateModule(moduleIndex, { estimated_workload: event.target.value })}
              className="bg-surface-container-low disabled:opacity-60"
            />
          </div>

          <label className="mt-4 block space-y-1.5">
            <span className="text-xs font-bold text-on-surface">Overview</span>
            <textarea value={module.overview ?? ""} disabled={disabled} rows={3} onChange={(event) => updateModule(moduleIndex, { overview: event.target.value })} className="w-full resize-y rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface ghost-border disabled:opacity-60" />
          </label>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-on-surface">Objectives</span>
              <textarea value={listToLines(module.objectives)} disabled={disabled} rows={4} onChange={(event) => updateModule(moduleIndex, { objectives: linesToList(event.target.value) })} className="w-full resize-y rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface ghost-border disabled:opacity-60" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-on-surface">Topics</span>
              <textarea value={listToLines(module.topics)} disabled={disabled} rows={4} onChange={(event) => updateModule(moduleIndex, { topics: linesToList(event.target.value) })} className="w-full resize-y rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface ghost-border disabled:opacity-60" />
            </label>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-bold text-on-surface">Module Sources</p>
            <SourcePicker selectedIds={module.source_chunk_ids ?? []} sources={sources} onChange={(source_chunk_ids) => updateModule(moduleIndex, { source_chunk_ids })} />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-on-surface">Draft Items</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => updateModule(moduleIndex, {
                  items: [...(module.items ?? []), { type: "page", title: "New Draft Item", purpose: "", source_chunk_ids: module.source_chunk_ids ?? [] }],
                })}
                className="h-auto px-2 py-1 text-[11px]"
              >
                Add Item
              </Button>
            </div>
            <div className="space-y-3">
              {(module.items ?? []).map((item, itemIndex) => (
                <div key={`${module.id || moduleIndex}-item-${itemIndex}`} className="rounded-lg bg-surface-container-low p-3">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[150px_1fr]">
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-bold text-on-surface">Type</span>
                      <select value={item.type} disabled={disabled} onChange={(event) => updateItem(moduleIndex, itemIndex, { type: event.target.value })} className="w-full rounded-lg bg-surface-container-lowest px-2 py-2 text-xs text-on-surface ghost-border disabled:opacity-60">
                        {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-bold text-on-surface">Title</span>
                      <input value={item.title} disabled={disabled} onChange={(event) => updateItem(moduleIndex, itemIndex, { title: event.target.value })} className="w-full rounded-lg bg-surface-container-lowest px-2 py-2 text-xs text-on-surface ghost-border disabled:opacity-60" />
                    </label>
                  </div>
                  <label className="mt-3 block space-y-1.5">
                    <span className="text-[11px] font-bold text-on-surface">Purpose</span>
                    <textarea value={item.purpose ?? ""} disabled={disabled} rows={2} onChange={(event) => updateItem(moduleIndex, itemIndex, { purpose: event.target.value })} className="w-full resize-y rounded-lg bg-surface-container-lowest px-2 py-2 text-xs text-on-surface ghost-border disabled:opacity-60" />
                  </label>
                  <div className="mt-3">
                    <p className="mb-2 text-[11px] font-bold text-on-surface">Item Sources</p>
                    <SourcePicker selectedIds={item.source_chunk_ids ?? []} sources={sources} onChange={(source_chunk_ids) => updateItem(moduleIndex, itemIndex, { source_chunk_ids })} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={disabled || itemIndex === 0} onClick={() => moveItem(moduleIndex, itemIndex, -1)} className="h-auto px-2 py-1 text-[11px]">Up</Button>
                    <Button type="button" variant="secondary" size="sm" disabled={disabled || itemIndex === (module.items?.length ?? 0) - 1} onClick={() => moveItem(moduleIndex, itemIndex, 1)} className="h-auto px-2 py-1 text-[11px]">Down</Button>
                    <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => updateModule(moduleIndex, { items: (module.items ?? []).filter((_, index) => index !== itemIndex) })} className="h-auto px-2 py-1 text-[11px]">Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
