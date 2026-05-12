"use client";

/**
 * Dialog for flagging content issues or replacing page content from known-good sources.
 */

import type { MouseEvent } from "react";
import { FileText, Flag, GraduationCap, RefreshCw, RotateCcw, Search, X } from "lucide-react";

import Button from "@/components/edplus/Button";

export type CanvasRevisionRow = {
  revision_id: number;
  updated_at: string | null;
  latest?: boolean | null;
  edited_by?: {
    id?: number | string | null;
    display_name?: string | null;
  } | null;
  title?: string | null;
};

export type CanvasRevisionPreview = CanvasRevisionRow & {
  body: string;
};

export type SourceCourse = {
  course_id: string;
  name: string;
  course_code?: string | null;
  workflow_state?: string | null;
  term_name?: string | null;
};

export type SourcePageMatch = {
  page_url: string;
  title: string;
  html_url?: string | null;
  updated_at?: string | null;
  published?: boolean | null;
};

export type SourcePagePreview = SourcePageMatch & {
  body: string;
};

type IdentifyIssueMode = "replace" | "flag";
type IdentifyIssueTab = "revisions" | "source";
type LoadSourceCourseOptions = { append?: boolean; cursor?: string | null };

type IdentifyIssueModalProps = {
  canvasRevisionPreview: CanvasRevisionPreview | null;
  canvasRevisionPreviewLoading: boolean;
  canvasRevisionRestoring: boolean;
  canvasRevisions: CanvasRevisionRow[];
  canvasRevisionsLoading: boolean;
  currentHtml: string;
  flagIssueNote: string;
  flagIssueSaving: boolean;
  formatDate: (value: string) => string;
  isDirty: boolean;
  itemContentType: string;
  message: string | null;
  mode: IdentifyIssueMode;
  onClose: () => void;
  onFlagIssueNoteChange: (value: string) => void;
  onLoadCanvasRevisionPreview: (revisionId: number) => void;
  onLoadSourceCourses: (query?: string, options?: LoadSourceCourseOptions) => void;
  onLoadSourcePagePreview: (page: SourcePageMatch) => void;
  onModeChange: (value: IdentifyIssueMode) => void;
  onRefreshCanvasRevisions: () => void;
  onReplaceFromSourcePage: () => void;
  onRestoreCanvasRevision: () => void;
  onSaveIssueFlag: () => void;
  onSelectSourceCourse: (course: SourceCourse) => void;
  onSourceCourseQueryChange: (value: string) => void;
  onTabChange: (value: IdentifyIssueTab) => void;
  selectedCanvasRevisionId: number | null;
  selectedSourceCourse: SourceCourse | null;
  selectedSourcePage: SourcePageMatch | null;
  sourceCourseQuery: string;
  sourceCourses: SourceCourse[];
  sourceCoursesCursor: string | null;
  sourceCoursesLoading: boolean;
  sourcePageMatches: SourcePageMatch[];
  sourcePagePreview: SourcePagePreview | null;
  sourcePagePreviewLoading: boolean;
  sourcePageReplacing: boolean;
  sourcePagesLoading: boolean;
  tab: IdentifyIssueTab;
};

export function IdentifyIssueModal({
  canvasRevisionPreview,
  canvasRevisionPreviewLoading,
  canvasRevisionRestoring,
  canvasRevisions,
  canvasRevisionsLoading,
  currentHtml,
  flagIssueNote,
  flagIssueSaving,
  formatDate,
  isDirty,
  itemContentType,
  message,
  mode,
  onClose,
  onFlagIssueNoteChange,
  onLoadCanvasRevisionPreview,
  onLoadSourceCourses,
  onLoadSourcePagePreview,
  onModeChange,
  onRefreshCanvasRevisions,
  onReplaceFromSourcePage,
  onRestoreCanvasRevision,
  onSaveIssueFlag,
  onSelectSourceCourse,
  onSourceCourseQueryChange,
  onTabChange,
  selectedCanvasRevisionId,
  selectedSourceCourse,
  selectedSourcePage,
  sourceCourseQuery,
  sourceCourses,
  sourceCoursesCursor,
  sourceCoursesLoading,
  sourcePageMatches,
  sourcePagePreview,
  sourcePagePreviewLoading,
  sourcePageReplacing,
  sourcePagesLoading,
  tab,
}: IdentifyIssueModalProps) {
  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="identify-issue-title"
        className="flex max-h-[90vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-outline-variant/30 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Content Review</p>
            <h2 id="identify-issue-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
              Identify Issue
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Restore known-good page content or flag this item for the audit report.
            </p>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {message ? (
            <div className="mb-4 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-semibold text-on-surface">
              {message}
            </div>
          ) : null}
          {isDirty ? (
            <div className="mb-4 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
              Save or cancel the current draft before restoring or replacing content.
            </div>
          ) : null}
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => onModeChange("replace")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "replace"
                  ? "border-primary bg-primary/10 text-on-surface"
                  : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm font-bold">
                <RotateCcw size={16} />
                Content needs replacing
              </span>
              <span className="mt-1 block text-xs text-on-surface-variant">
                Compare versions and restore from Canvas history or a source course.
              </span>
            </button>
            <button
              type="button"
              onClick={() => onModeChange("flag")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "flag"
                  ? "border-primary bg-primary/10 text-on-surface"
                  : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm font-bold">
                <Flag size={16} />
                Flag issue
              </span>
              <span className="mt-1 block text-xs text-on-surface-variant">
                Record an issue for follow-up and the phase 6 audit report.
              </span>
            </button>
          </div>

          {mode === "flag" ? (
            <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-4">
              <label className="block text-sm font-semibold text-on-surface">
                Issue notes
                <textarea
                  value={flagIssueNote}
                  onChange={(event) => onFlagIssueNoteChange(event.target.value)}
                  rows={6}
                  placeholder="Describe what needs follow-up, where it appears, or why this content should be reviewed."
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onTabChange("revisions")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    tab === "revisions"
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  Previous Versions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onTabChange("source");
                    if (!sourceCourses.length && !sourceCoursesLoading) onLoadSourceCourses();
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    tab === "source"
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  Source Course
                </button>
              </div>

              {itemContentType !== "page" ? (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-6 text-sm text-on-surface-variant">
                  Previous-version replacement is currently available for pages. Other content types should be flagged for review.
                </div>
              ) : null}
              {itemContentType === "page" && tabPanel({
                canvasRevisionPreview,
                canvasRevisionPreviewLoading,
                canvasRevisions,
                canvasRevisionsLoading,
                currentHtml,
                formatDate,
                onLoadCanvasRevisionPreview,
                onLoadSourceCourses,
                onLoadSourcePagePreview,
                onRefreshCanvasRevisions,
                onSelectSourceCourse,
                onSourceCourseQueryChange,
                selectedCanvasRevisionId,
                selectedSourceCourse,
                selectedSourcePage,
                sourceCourseQuery,
                sourceCourses,
                sourceCoursesCursor,
                sourceCoursesLoading,
                sourcePageMatches,
                sourcePagePreview,
                sourcePagePreviewLoading,
                sourcePagesLoading,
                tab,
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-6 py-4">
          <Button
            type="button"
            onClick={onClose}
            variant="ghost"
          >
            Cancel
          </Button>
          {mode === "flag" ? (
            <Button
              type="button"
              onClick={onSaveIssueFlag}
              disabled={flagIssueSaving}
              loading={flagIssueSaving}
            >
              Flag Issue
            </Button>
          ) : tab === "source" ? (
            <Button
              type="button"
              onClick={onReplaceFromSourcePage}
              disabled={isDirty || sourcePageReplacing || !selectedSourcePage || !sourcePagePreview}
              loading={sourcePageReplacing}
            >
              Replace with Source Page
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onRestoreCanvasRevision}
              disabled={isDirty || canvasRevisionRestoring || !selectedCanvasRevisionId || !canvasRevisionPreview}
              loading={canvasRevisionRestoring}
            >
              Restore Selected Version
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function tabPanel({
  canvasRevisionPreview,
  canvasRevisionPreviewLoading,
  canvasRevisions,
  canvasRevisionsLoading,
  currentHtml,
  formatDate,
  onLoadCanvasRevisionPreview,
  onLoadSourceCourses,
  onLoadSourcePagePreview,
  onRefreshCanvasRevisions,
  onSelectSourceCourse,
  onSourceCourseQueryChange,
  selectedCanvasRevisionId,
  selectedSourceCourse,
  selectedSourcePage,
  sourceCourseQuery,
  sourceCourses,
  sourceCoursesCursor,
  sourceCoursesLoading,
  sourcePageMatches,
  sourcePagePreview,
  sourcePagePreviewLoading,
  sourcePagesLoading,
  tab,
}: {
  canvasRevisionPreview: CanvasRevisionPreview | null;
  canvasRevisionPreviewLoading: boolean;
  canvasRevisions: CanvasRevisionRow[];
  canvasRevisionsLoading: boolean;
  currentHtml: string;
  formatDate: (value: string) => string;
  onLoadCanvasRevisionPreview: (revisionId: number) => void;
  onLoadSourceCourses: (query?: string, options?: LoadSourceCourseOptions) => void;
  onLoadSourcePagePreview: (page: SourcePageMatch) => void;
  onRefreshCanvasRevisions: () => void;
  onSelectSourceCourse: (course: SourceCourse) => void;
  onSourceCourseQueryChange: (value: string) => void;
  selectedCanvasRevisionId: number | null;
  selectedSourceCourse: SourceCourse | null;
  selectedSourcePage: SourcePageMatch | null;
  sourceCourseQuery: string;
  sourceCourses: SourceCourse[];
  sourceCoursesCursor: string | null;
  sourceCoursesLoading: boolean;
  sourcePageMatches: SourcePageMatch[];
  sourcePagePreview: SourcePagePreview | null;
  sourcePagePreviewLoading: boolean;
  sourcePagesLoading: boolean;
  tab: IdentifyIssueTab;
}) {
  if (tab === "revisions") {
    return (
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Canvas Revisions</p>
            <button
              type="button"
              title="Refresh revisions"
              onClick={onRefreshCanvasRevisions}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {canvasRevisionsLoading ? (
            <p className="text-sm text-on-surface-variant">Loading revisions...</p>
          ) : canvasRevisions.length ? (
            <div className="max-h-[48vh] space-y-2 overflow-y-auto">
              {canvasRevisions.map((revision) => (
                <button
                  key={revision.revision_id}
                  type="button"
                  onClick={() => onLoadCanvasRevisionPreview(revision.revision_id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedCanvasRevisionId === revision.revision_id
                      ? "border-primary bg-primary/10"
                      : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                  }`}
                >
                  <span className="block font-semibold text-on-surface">
                    Revision {revision.revision_id}{revision.latest ? " - latest" : ""}
                  </span>
                  <span className="block text-xs text-on-surface-variant">
                    {revision.updated_at ? formatDate(revision.updated_at) : "No date"}
                    {revision.edited_by?.display_name ? ` - ${revision.edited_by.display_name}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">No Canvas revisions were found for this page.</p>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <ContentPreview title="Current Draft" html={currentHtml} emptyMessage="No content" />
          <ContentPreview
            title="Selected Revision"
            html={canvasRevisionPreview?.body ?? ""}
            emptyMessage="Choose a revision to preview it."
            loading={canvasRevisionPreviewLoading}
            loadingMessage="Loading preview..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Courses</p>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onLoadSourceCourses(sourceCourseQuery, { append: false });
            }}
          >
            <input
              value={sourceCourseQuery}
              onChange={(event) => onSourceCourseQueryChange(event.target.value)}
              placeholder="Search courses..."
              className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-container-low px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
            >
              <Search size={15} />
              Search
            </button>
          </form>
          {sourceCoursesLoading && !sourceCourses.length ? (
            <p className="text-sm text-on-surface-variant">Loading courses...</p>
          ) : sourceCourses.length ? (
            <div className="max-h-[30vh] space-y-2 overflow-y-auto">
              {sourceCourses.map((course) => (
                <button
                  key={course.course_id}
                  type="button"
                  onClick={() => onSelectSourceCourse(course)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedSourceCourse?.course_id === course.course_id
                      ? "border-primary bg-primary/10"
                      : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-on-surface">
                    <GraduationCap size={14} />
                    <span className="truncate">{course.name}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-on-surface-variant">
                    {[course.course_code, course.term_name].filter(Boolean).join(" - ") || `Course ${course.course_id}`}
                  </span>
                </button>
              ))}
              {sourceCoursesCursor ? (
                <button
                  type="button"
                  onClick={() => onLoadSourceCourses(sourceCourseQuery, { append: true, cursor: sourceCoursesCursor })}
                  disabled={sourceCoursesLoading}
                  className="w-full rounded-lg border border-dashed border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-center text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sourceCoursesLoading ? "Loading more..." : "Load more courses"}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">No courses found.</p>
          )}
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Matching Pages</p>
          {sourcePagesLoading ? (
            <p className="text-sm text-on-surface-variant">Searching pages...</p>
          ) : sourcePageMatches.length ? (
            <div className="max-h-[24vh] space-y-2 overflow-y-auto">
              {sourcePageMatches.map((page) => (
                <button
                  key={page.page_url}
                  type="button"
                  onClick={() => onLoadSourcePagePreview(page)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedSourcePage?.page_url === page.page_url
                      ? "border-primary bg-primary/10"
                      : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-on-surface">
                    <FileText size={14} />
                    <span className="truncate">{page.title}</span>
                  </span>
                  <span className="mt-1 block text-xs text-on-surface-variant">
                    {page.updated_at ? formatDate(page.updated_at) : page.page_url}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">
              {selectedSourceCourse ? "No matching pages found." : "Choose a course to search for a matching page title."}
            </p>
          )}
        </div>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <ContentPreview title="Current Draft" html={currentHtml} emptyMessage="No content" />
        <ContentPreview
          title="Source Page"
          html={sourcePagePreview?.body ?? ""}
          emptyMessage="Choose a matching page to preview it."
          loading={sourcePagePreviewLoading}
          loadingMessage="Loading source preview..."
        />
      </div>
    </div>
  );
}

function ContentPreview({
  emptyMessage,
  html,
  loading = false,
  loadingMessage = "Loading...",
  title,
}: {
  emptyMessage: string;
  html: string;
  loading?: boolean;
  loadingMessage?: string;
  title: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
      <div className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
        {title}
      </div>
      {loading ? (
        <div className="p-4 text-sm text-on-surface-variant">{loadingMessage}</div>
      ) : html ? (
        <div className="canvas-content max-h-[52vh] overflow-auto p-4 text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="p-4 text-sm text-on-surface-variant">{emptyMessage}</div>
      )}
    </div>
  );
}
