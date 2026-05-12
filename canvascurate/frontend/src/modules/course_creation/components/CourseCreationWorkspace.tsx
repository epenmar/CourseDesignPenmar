"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, ButtonLink, Card, CardBody, CardSkeleton, EmptyState, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import {
  confirmCourseCreationExport,
  deleteCourseCreationSource,
  generateCourseCreationDrafts,
  generateCourseCreationOutline,
  loadCourseCreationDraftPreview,
  loadCourseCreationProject,
  loadCourseCreationSourceChunks,
  queueCourseCreationExtraction,
  saveCourseCreationOutline,
  saveCourseCreationSetup,
  uploadCourseCreationSource,
} from "../api/courseCreationClient";
import OutlineReviewPanel from "./OutlineReviewPanel";
import type {
  CourseCreationOutline,
  CourseCreationDraftPreview,
  CourseCreationProject,
  CourseCreationSetup,
  CourseCreationSource,
  CourseCreationSourceAnalysisItem,
} from "../types";

const EMPTY_SETUP: CourseCreationSetup = {
  course_title: "",
  course_code: "",
  course_description: "",
  audience: "",
  level: "",
  term_length: "",
  module_count: null,
  module_cadence: "",
  source_notes: "",
};

function formatBytes(value?: number | null) {
  if (!value) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClass(status: string) {
  if (status === "succeeded") return "bg-[#446D12] text-white";
  if (status === "running" || status === "queued") return "bg-secondary-container/30 text-secondary";
  if (status === "needs_extractor") return "bg-surface-container-high text-on-surface-variant";
  if (status === "failed") return "bg-error-container text-on-error-container";
  return "bg-surface-container-high text-on-surface-variant";
}

function sourceStatusLabel(source: CourseCreationSource) {
  if (source.extraction_status === "needs_extractor") return "Extractor pending";
  if (source.extraction_status === "not_started") return "Not extracted";
  return source.extraction_status;
}

function SourceRow({
  source,
  onExtract,
  onDelete,
  disabled,
}: {
  source: CourseCreationSource;
  onExtract: (sourceId: string) => void;
  onDelete: (sourceId: string) => void;
  disabled: boolean;
}) {
  const summary = source.extraction_summary;
  const previewChunks = summary?.preview_chunks ?? [];

  return (
    <Card>
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-headline text-sm font-bold text-on-surface">{source.filename}</h4>
            <Badge className={`px-2.5 py-1 text-[10px] uppercase ${statusClass(source.extraction_status)}`}>
              {sourceStatusLabel(source)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">
            {source.content_type ?? "Unknown type"} | {formatBytes(source.size_bytes)}
          </p>
          {summary?.message ? (
            <p className="mt-3 text-sm text-on-surface-variant">{summary.message}</p>
          ) : null}
          {summary ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-on-surface-variant">
              <span className="rounded-md bg-surface-container-low px-2 py-1">{summary.chunk_count ?? 0} chunks</span>
              <span className="rounded-md bg-surface-container-low px-2 py-1">{summary.text_char_count ?? 0} chars</span>
              {summary.page_count ? (
                <span className="rounded-md bg-surface-container-low px-2 py-1">{summary.page_count} pages</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onExtract(source.id)}
            disabled={disabled || source.extraction_status === "queued" || source.extraction_status === "running"}
            className="text-xs"
          >
            Extract
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDelete(source.id)}
            disabled={disabled}
            className="text-xs"
          >
            Remove
          </Button>
        </div>
      </div>

      {previewChunks.length > 0 ? (
        <div className="border-t border-outline-variant/20 px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
            Extraction Preview
          </p>
          <div className="space-y-2">
            {previewChunks.slice(0, 3).map((chunk) => (
              <div key={chunk.id} className="rounded-lg bg-surface-container-low p-3">
                <p className="text-xs font-bold text-on-surface">{chunk.title}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-on-surface-variant">
                  {chunk.text_preview}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function CourseCreationWorkspace({ sessionId }: { sessionId: string }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [project, setProject] = useState<CourseCreationProject | null>(null);
  const [setup, setSetup] = useState<CourseCreationSetup>(EMPTY_SETUP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);
  const [savingOutline, setSavingOutline] = useState(false);
  const [outlineDirty, setOutlineDirty] = useState(false);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourcePool, setSourcePool] = useState<CourseCreationSourceAnalysisItem[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<CourseCreationDraftPreview | null>(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [exportPreviewError, setExportPreviewError] = useState<string | null>(null);
  const [selectedPreviewItemId, setSelectedPreviewItemId] = useState<string | null>(null);
  const [confirmingExport, setConfirmingExport] = useState(false);

  const hasActiveExtraction = useMemo(
    () => project?.sources.some((source) => ["queued", "running"].includes(source.extraction_status)) ?? false,
    [project?.sources],
  );
  const hasActiveOutlineGeneration = ["queued", "running"].includes(project?.outline_generation?.status ?? "");
  const hasActiveDraftGeneration = ["queued", "running"].includes(project?.draft_generation?.status ?? "");
  const hasActiveProjectJob = hasActiveExtraction || hasActiveOutlineGeneration || hasActiveDraftGeneration;
  const draftButtonBusy = generatingDrafts || hasActiveDraftGeneration;
  const outlineModuleCount = project?.outline?.modules.length ?? 0;
  const outlineSourceKey = project?.outline?.review_revision_id ?? project?.outline?.job_id ?? "";
  const materializedModuleCount = project?.draft_generation?.module_count ?? 0;
  const draftsComplete = project?.draft_generation?.status === "succeeded" && materializedModuleCount >= outlineModuleCount;
  const hasReadySources = useMemo(
    () => project?.sources.some((source) => source.extraction_status === "succeeded" && source.extraction_summary?.artifact_key) ?? false,
    [project?.sources],
  );

  const refreshProject = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const nextProject = await loadCourseCreationProject(sessionId);
      setProject(nextProject);
      setSetup(nextProject.setup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Course Creation project");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadCourseCreationProject(sessionId)
        .then((nextProject) => {
          if (cancelled) return;
          setProject(nextProject);
          setSetup(nextProject.setup);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "Failed to load Course Creation project");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!hasActiveProjectJob) return;
    const timer = window.setInterval(() => {
      void refreshProject(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveProjectJob, refreshProject]);

  useEffect(() => {
    if (!outlineSourceKey || !hasReadySources) {
      const timer = window.setTimeout(() => setSourcePool([]), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void loadCourseCreationSourceChunks(sessionId)
      .then((items) => {
        if (!cancelled) setSourcePool(items);
      })
      .catch(() => {
        if (!cancelled) setSourcePool(project?.source_analysis?.items ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [hasReadySources, outlineSourceKey, project?.source_analysis?.items, sessionId]);

  function updateSetupField<K extends keyof CourseCreationSetup>(key: K, value: CourseCreationSetup[K]) {
    setSetup((current) => ({ ...current, [key]: value }));
  }

  async function handleSaveSetup() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const nextProject = await saveCourseCreationSetup(sessionId, setup);
      setProject(nextProject);
      setSetup(nextProject.setup);
      setNotice("Course setup saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save Course Creation setup");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      await uploadCourseCreationSource(sessionId, file);
      await refreshProject(true);
      setNotice("Source uploaded and extraction queued.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload source file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleExtract(sourceId: string) {
    setBusySourceId(sourceId);
    setError(null);
    setNotice(null);
    try {
      await queueCourseCreationExtraction(sessionId, sourceId);
      await refreshProject(true);
      setNotice("Extraction queued.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to queue extraction");
    } finally {
      setBusySourceId(null);
    }
  }

  async function handleDelete(sourceId: string) {
    setBusySourceId(sourceId);
    setError(null);
    setNotice(null);
    try {
      await deleteCourseCreationSource(sessionId, sourceId);
      await refreshProject(true);
      setNotice("Source removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove source");
    } finally {
      setBusySourceId(null);
    }
  }

  async function handleGenerateOutline() {
    setGeneratingOutline(true);
    setError(null);
    setNotice(null);
    try {
      const { project: nextProject } = await generateCourseCreationOutline(sessionId);
      setProject(nextProject);
      setSetup(nextProject.setup);
      setNotice("Course outline generation queued.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate course outline");
    } finally {
      setGeneratingOutline(false);
    }
  }

  async function handleGenerateDrafts() {
    setGeneratingDrafts(true);
    setError(null);
    setNotice(null);
    try {
      const { project: nextProject } = await generateCourseCreationDrafts(sessionId);
      setProject(nextProject);
      setSetup(nextProject.setup);
      setNotice("Editable draft generation queued.");
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create editable drafts");
    } finally {
      setGeneratingDrafts(false);
    }
  }

  async function handleSaveOutline(outline: CourseCreationOutline) {
    setSavingOutline(true);
    setError(null);
    setNotice(null);
    try {
      const nextProject = await saveCourseCreationOutline(sessionId, outline);
      setProject(nextProject);
      setSetup(nextProject.setup);
      setOutlineDirty(false);
      setNotice("Reviewed outline saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save reviewed outline");
    } finally {
      setSavingOutline(false);
    }
  }

  async function handleOpenExportModal() {
    setExportModalOpen(true);
    setExportPreviewLoading(true);
    setExportPreviewError(null);
    try {
      const preview = await loadCourseCreationDraftPreview(sessionId);
      setExportPreview(preview);
      const firstItem = preview.modules.flatMap((module) => module.items)[0];
      setSelectedPreviewItemId(firstItem?.id ?? null);
    } catch (e) {
      setExportPreviewError(e instanceof Error ? e.message : "Failed to load generated draft preview");
    } finally {
      setExportPreviewLoading(false);
    }
  }

  async function handleConfirmExport() {
    setConfirmingExport(true);
    setExportPreviewError(null);
    try {
      await confirmCourseCreationExport(sessionId);
      window.location.href = `/sessions/${sessionId}/edit`;
    } catch (e) {
      setExportPreviewError(e instanceof Error ? e.message : "Failed to confirm Canvas Clean export");
      setConfirmingExport(false);
    }
  }

  if (loading && !project) {
    return (
      <div className="mx-auto max-w-6xl">
        <CardSkeleton lines={5} />
      </div>
    );
  }

  if (project?.status === "exported_to_canvas_clean") {
    return (
      <Card className="mx-auto max-w-4xl" elevated>
        <CardBody>
          <Badge variant="success" className="uppercase tracking-[0.18em]">Export Complete</Badge>
          <h2 className="mt-3 font-headline text-2xl font-extrabold text-on-surface">
            This generated course is in Canvas Clean
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            The Course Creation outline has already been confirmed. Continue in Canvas Clean to edit content, use the review tools, and prepare the course for transfer.
          </p>
          <ButtonLink href={`/sessions/${sessionId}/edit`} className="mt-6">
            Open Canvas Clean
          </ButtonLink>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
            Course Creation
          </p>
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            {project?.name ?? "New Course Build"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            Build the course draft from source documentation before choosing whether to push it to Canvas.
          </p>
        </div>
        <Badge className="w-fit px-3 py-1.5 text-[10px] uppercase tracking-wider">
          {project?.status ?? "draft"}
        </Badge>
      </header>

      {error ? (
        <Alert variant="error">{error}</Alert>
      ) : null}
      {notice ? (
        <Alert variant="success">{notice}</Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardBody>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-headline text-lg font-bold text-on-surface">Project Setup</h3>
              <p className="mt-1 text-xs text-on-surface-variant">
                These values become the course build brief for outline generation.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              loading={saving}
              onClick={() => void handleSaveSetup()}
              disabled={saving}
              className="text-xs"
            >
              Save
            </Button>
          </div>

          <div className="space-y-4">
            <Input
              label="Course Title"
              value={setup.course_title}
              onChange={(event) => updateSetupField("course_title", event.target.value)}
              placeholder="e.g. Introduction to Biology"
              fullWidth
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Course Code" value={setup.course_code} onChange={(event) => updateSetupField("course_code", event.target.value)} placeholder="BIO 100" fullWidth />
              <Input label="Level" value={setup.level} onChange={(event) => updateSetupField("level", event.target.value)} placeholder="Undergraduate" fullWidth />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Term Length" value={setup.term_length} onChange={(event) => updateSetupField("term_length", event.target.value)} placeholder="7.5 weeks" fullWidth />
              <Input label="Module Cadence" value={setup.module_cadence} onChange={(event) => updateSetupField("module_cadence", event.target.value)} placeholder="Weekly" fullWidth />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Module Count"
                type="number"
                min={1}
                max={40}
                value={setup.module_count ?? ""}
                onChange={(event) => updateSetupField("module_count", event.target.value ? Number(event.target.value) : null)}
                placeholder="8"
                fullWidth
              />
            </div>
            <Input
              label="Audience"
              value={setup.audience}
              onChange={(event) => updateSetupField("audience", event.target.value)}
              placeholder="Learners, program, prerequisites"
              fullWidth
            />
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-on-surface">Course Description</span>
              <textarea
                value={setup.course_description}
                onChange={(event) => updateSetupField("course_description", event.target.value)}
                rows={4}
                className="w-full resize-y rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-secondary-container/50 ghost-border"
                placeholder="Short description, learning context, and constraints"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-on-surface">Source Notes</span>
              <textarea
                value={setup.source_notes}
                onChange={(event) => updateSetupField("source_notes", event.target.value)}
                rows={3}
                className="w-full resize-y rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-secondary-container/50 ghost-border"
                placeholder="What to prioritize, ignore, or preserve from uploaded material"
              />
            </label>
          </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-headline text-lg font-bold text-on-surface">Source Documentation</h3>
              <p className="mt-1 text-xs text-on-surface-variant">
                Upload source files and review extraction before generating course structure.
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.html,.htm"
                onChange={(event) => void handleFileSelected(event.target.files)}
              />
              <Button
                type="button"
                size="sm"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs"
              >
                Upload Source
              </Button>
            </div>
          </div>

          {!project?.sources.length ? (
            <EmptyState
              title="No source files yet"
              description="Start with syllabi, course maps, readings, lecture files, or existing course planning documents."
              size="sm"
              className="rounded-xl bg-surface-container-low"
            />
          ) : (
            <div className="space-y-4">
              {project.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  disabled={busySourceId === source.id}
                  onExtract={(sourceId) => void handleExtract(sourceId)}
                  onDelete={(sourceId) => void handleDelete(sourceId)}
                />
              ))}
            </div>
          )}
          </CardBody>
        </Card>
      </section>

      <Card className="p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-headline text-lg font-bold text-on-surface">Generated Outline</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-on-surface-variant">
              Generate a reviewable module outline from extracted source content before creating Canvas drafts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              loading={generatingOutline || hasActiveOutlineGeneration}
              onClick={() => void handleGenerateOutline()}
              disabled={generatingOutline || hasActiveOutlineGeneration || !hasReadySources}
              className="text-xs"
            >
              {hasActiveOutlineGeneration
                ? "Generating"
                : generatingOutline
                  ? "Queueing"
                  : project?.outline
                    ? "Regenerate Outline"
                    : "Generate Outline"}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={draftButtonBusy}
              onClick={() => void handleGenerateDrafts()}
              disabled={generatingDrafts || hasActiveDraftGeneration || !project?.outline || draftsComplete || outlineDirty}
              className="text-xs"
            >
              {hasActiveDraftGeneration
                ? "Creating"
                : generatingDrafts
                  ? "Creating"
                  : draftsComplete
                    ? "Drafts Created"
                    : project?.draft_generation?.status === "succeeded"
                      ? "Resume Drafts"
                      : outlineDirty
                      ? "Save Outline First"
                      : "Create Editable Drafts"}
            </Button>
          </div>
        </div>

        {!hasReadySources ? (
          <Alert variant="info">Extract at least one source file before generating an outline.</Alert>
        ) : project?.outline_generation?.status === "failed" ? (
          <Alert variant="error">{project.outline_generation.error ?? "Outline generation failed."}</Alert>
        ) : project?.outline_generation?.status === "succeeded_with_fallback" ? (
          <Alert variant="warning" className="mb-5">
            <p>AI outline JSON needed repair, so Curator generated a source-backed fallback outline for review.</p>
            {project.outline_generation.warning ? (
              <p className="mt-2 text-xs text-secondary/80">{project.outline_generation.warning}</p>
            ) : null}
            {project.outline_generation.raw_response_excerpt ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold">Show AI response excerpt</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-lowest p-3 text-[11px] leading-relaxed text-on-surface">
                  {project.outline_generation.raw_response_excerpt}
                </pre>
              </details>
            ) : null}
          </Alert>
        ) : null}

        {project?.draft_generation?.status === "failed" ? (
          <Alert variant="error" className="mb-5">{project.draft_generation.error ?? "Draft generation failed."}</Alert>
        ) : null}

        {hasActiveDraftGeneration ? (
          <Alert variant="info" className="mb-5">
            Creating editable Canvas Clean drafts. You can leave this page open while Curator finishes the background job.
          </Alert>
        ) : null}

        {project?.draft_generation?.status === "succeeded" ? (
          <Alert variant="success" className="mb-5">
            <p>
              Materialized {project.draft_generation.content_item_count ?? 0} editable drafts across {project.draft_generation.module_count ?? 0} modules.
            </p>
            {(project.draft_generation.created_content_item_count || project.draft_generation.skipped_existing_content_item_count) ? (
              <p className="mt-1 text-xs text-primary/80">
                New this run: {project.draft_generation.created_content_item_count ?? 0} items
                {project.draft_generation.skipped_existing_content_item_count ? `; reused ${project.draft_generation.skipped_existing_content_item_count} existing items` : ""}.
              </p>
            ) : null}
            {project.draft_generation.ai_body_generation ? (
              <p className="mt-1 text-xs text-primary/80">
                AI body drafts: {project.draft_generation.ai_body_generation.succeeded ?? 0} succeeded
                {project.draft_generation.ai_body_generation.fallback ? `, ${project.draft_generation.ai_body_generation.fallback} used template fallback` : ""}.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleOpenExportModal()}
              className="mt-2 inline-flex text-xs font-bold underline"
            >
              Export to Canvas Clean
            </button>
          </Alert>
        ) : null}

        {project?.source_analysis?.items?.length ? (
          <div className="mb-6">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
              Source Analysis
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {project.source_analysis.items.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-xl bg-surface-container-low p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-headline text-sm font-bold text-on-surface">{item.source_title || item.id}</p>
                    {typeof item.confidence === "number" ? (
                      <span className="rounded-md bg-surface-container-high px-2 py-1 text-[10px] font-bold text-on-surface-variant">
                        {Math.round(item.confidence * 100)}%
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-on-surface-variant">{item.summary}</p>
                  {item.topics?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.topics.slice(0, 4).map((topic) => (
                        <span key={topic} className="rounded-md bg-surface-container-high px-2 py-1 text-[10px] font-semibold text-on-surface-variant">
                          {topic}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {project?.outline ? (
          <div className="space-y-4">
            <OutlineReviewPanel
              outline={project.outline}
              sources={sourcePool.length ? sourcePool : project.source_analysis?.items ?? []}
              saving={savingOutline}
              disabled={hasActiveOutlineGeneration || hasActiveDraftGeneration}
              onSave={handleSaveOutline}
              onDirtyChange={setOutlineDirty}
            />

            {(project.outline.gaps?.length || project.outline.assumptions?.length) ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {project.outline.gaps?.length ? (
                  <div className="rounded-xl bg-surface-container-low p-4">
                    <p className="mb-2 text-xs font-bold text-on-surface">Gaps</p>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-on-surface-variant">
                      {project.outline.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                    </ul>
                  </div>
                ) : null}
                {project.outline.assumptions?.length ? (
                  <div className="rounded-xl bg-surface-container-low p-4">
                    <p className="mb-2 text-xs font-bold text-on-surface">Assumptions</p>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-on-surface-variant">
                      {project.outline.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="No generated outline yet"
            description="Once source extraction is ready, generate an outline to review modules, objectives, and recommended Canvas draft items."
            size="sm"
            className="rounded-xl bg-surface-container-low"
          />
        )}
      </Card>

      {exportModalOpen ? (
        <Modal
          open
          onOpenChange={(open) => { if (!open) setExportModalOpen(false); }}
          title="Export Generated Course to Canvas Clean"
          subtitle="Confirm Export"
          size="full"
          className="max-h-[90vh]"
        >
          <ModalBody className="grid min-h-0 gap-0 overflow-hidden p-0 lg:grid-cols-[340px_1fr]">
            <div className="col-span-full border-b border-outline-variant/30 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <p className="max-w-3xl text-sm leading-relaxed text-on-surface-variant">
                  Review the generated modules and items before continuing. After confirming, this outline review step is complete and you will continue in Canvas Clean with the editor and related review tools.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge className="rounded-lg px-3 py-2">
                    {project?.draft_generation?.module_count ?? exportPreview?.module_count ?? 0} modules
                  </Badge>
                  <Badge className="rounded-lg px-3 py-2">
                    {project?.draft_generation?.content_item_count ?? exportPreview?.content_item_count ?? 0} items
                  </Badge>
                </div>
              </div>
            </div>

              <div className="min-h-0 overflow-auto border-b border-outline-variant/30 p-4 lg:border-b-0 lg:border-r">
                {exportPreviewLoading ? (
                  <CardSkeleton lines={4} />
                ) : exportPreviewError ? (
                  <Alert variant="error">{exportPreviewError}</Alert>
                ) : exportPreview?.modules.length ? (
                  <div className="space-y-4">
                    {exportPreview.modules.map((module, moduleIndex) => (
                      <div key={module.id} className="rounded-xl bg-surface-container-low p-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">
                          Module {moduleIndex + 1}
                        </p>
                        <p className="mt-1 text-sm font-bold text-on-surface">{module.title}</p>
                        <div className="mt-3 space-y-2">
                          {module.items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedPreviewItemId(item.id)}
                              className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                                selectedPreviewItemId === item.id
                                  ? "bg-primary text-on-primary"
                                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                              }`}
                            >
                              <span className="block font-bold">{item.title}</span>
                              <span className="mt-1 block uppercase tracking-wide opacity-80">{item.content_type}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No generated draft items" description="No generated draft items were found for this outline." size="sm" />
                )}
              </div>

              <div className="min-h-0 overflow-auto bg-surface-container-low p-4">
                {(() => {
                  const selected = exportPreview?.modules.flatMap((module) => module.items).find((item) => item.id === selectedPreviewItemId);
                  if (!selected) {
                    return (
                      <EmptyState title="Select an item" description="Select a generated item to preview." size="sm" />
                    );
                  }
                  return (
                    <div className="rounded-xl bg-surface-container-lowest p-4 ghost-border">
                      <div className="mb-3 flex flex-col gap-1 border-b border-outline-variant/20 pb-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
                          {selected.content_type}
                        </p>
                        <h4 className="font-headline text-base font-bold text-on-surface">{selected.title}</h4>
                      </div>
                      <iframe
                        title={selected.title ?? "Generated item preview"}
                        srcDoc={selected.html_body || "<p>No preview content available.</p>"}
                        sandbox=""
                        className="h-[48vh] w-full rounded-lg bg-white"
                      />
                    </div>
                  );
                })()}
              </div>
          </ModalBody>
          <ModalFooter className="flex-col md:flex-row md:items-center md:justify-between">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Close this modal if you want to regenerate or revise the outline before continuing. Confirm Export finalizes this handoff and opens the generated course in Canvas Clean.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setExportModalOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirmExport()}
                disabled={!exportPreview?.content_item_count || confirmingExport}
                loading={confirmingExport}
              >
                Confirm Export
              </Button>
            </div>
          </ModalFooter>
        </Modal>
      ) : null}
    </div>
  );
}
