/**
 * Phase 6 Transfer workspace.
 *
 * This first slice is intentionally read-only: it presents readiness and mode
 * selection before Canvas write jobs are enabled.
 */

"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Target, X } from "lucide-react";
import { loadTransferJob, loadTransferReadiness, startTransferJob, startTransferTargetBackup, validateTransferTarget } from "../api/transferClient";
import type { TransferJob, TransferMode, TransferReadiness, TransferTargetCourse } from "../types";
import TransferModeCards from "./TransferModeCards";
import TransferSummaryPanel from "./TransferSummaryPanel";
import { DeletionCandidateList, ModuleOperationList, PendingContentList, TransferIssueList } from "./PendingTransferList";
import TransferJobReportPanel from "./TransferJobReport";
import TransferTargetModal from "./TransferTargetModal";

export default function TransferWorkspace({ sessionId }: { sessionId: string }) {
  const [readiness, setReadiness] = useState<TransferReadiness | null>(null);
  const [selectedMode, setSelectedMode] = useState<TransferMode | null>(null);
  const [targetCourse, setTargetCourse] = useState("");
  const [validatedTargetCourse, setValidatedTargetCourse] = useState<TransferTargetCourse | null>(null);
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [sameCourseModalOpen, setSameCourseModalOpen] = useState(false);
  const [validatingTarget, setValidatingTarget] = useState(false);
  const [targetValidationError, setTargetValidationError] = useState<string | null>(null);
  const [eraseFirst, setEraseFirst] = useState(false);
  const [targetBackupJob, setTargetBackupJob] = useState<TransferJob | null>(null);
  const [startingBackup, setStartingBackup] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [eraseWithoutBackupConfirmed, setEraseWithoutBackupConfirmed] = useState(false);
  const [activeJob, setActiveJob] = useState<TransferJob | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [startingJob, setStartingJob] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadTransferReadiness(sessionId);
      setReadiness(next);
      setSelectedMode((current) => current ?? next.recommended_mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Transfer readiness");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReadiness();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReadiness]);

  useEffect(() => {
    if (!activeJob || !["queued", "running", "retrying"].includes(activeJob.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await loadTransferJob(sessionId, activeJob.id);
        setActiveJob(result.job);
        if (result.job.status === "succeeded") {
          void loadReadiness();
        }
      } catch (e) {
        setJobError(e instanceof Error ? e.message : "Failed to refresh Transfer job");
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeJob, loadReadiness, sessionId]);

  useEffect(() => {
    if (!targetBackupJob || !["queued", "running", "retrying"].includes(targetBackupJob.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await loadTransferJob(sessionId, targetBackupJob.id);
        setTargetBackupJob(result.job);
      } catch (e) {
        setBackupError(e instanceof Error ? e.message : "Failed to refresh target backup");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sessionId, targetBackupJob]);

  const selectedModeRequiresTarget = selectedMode === "target_course" || selectedMode === "copy_course";
  const selectedModeIsSameCourse = selectedMode === "same_course";
  const selectedModeIsCopyCourse = selectedMode === "copy_course";
  const sameCourseReadyItemCount = readiness?.summary.same_course_action_count ?? readiness?.summary.same_course_push_count ?? readiness?.summary.ready_item_count ?? 0;
  const targetReadyItemCount = readiness?.summary.transfer_payload_count ?? readiness?.summary.transferable_content_count ?? 0;
  const referencedFileCount = readiness?.summary.referenced_file_count ?? 0;
  const displayedReadyItemCount = selectedModeIsCopyCourse ? 1 : selectedModeRequiresTarget ? targetReadyItemCount : sameCourseReadyItemCount;
  const refreshInProgress = loading && Boolean(readiness);
  const activeJobIsRunning = activeJob ? ["queued", "running", "retrying"].includes(activeJob.status) : false;
  const actionDisabledReason = useMemo(() => {
    if (!readiness) return "Transfer readiness is still loading.";
    if (activeJobIsRunning) return "A Transfer job is already running.";
    if (selectedModeIsCopyCourse && !readiness.source_course?.canvas_course_id) return "Copy to target requires a connected source Canvas course.";
    if (!displayedReadyItemCount) return selectedModeRequiresTarget
      ? "No in-module content is available to transfer to a target course."
      : "No generated or modified items are ready for same-course push.";
    if (selectedModeRequiresTarget && !validatedTargetCourse) return "Validate a target course before transfer jobs can run.";
    return null;
  }, [readiness, activeJobIsRunning, displayedReadyItemCount, selectedModeIsCopyCourse, selectedModeRequiresTarget, validatedTargetCourse]);

  async function handleValidateTargetCourse() {
    if (!targetCourse.trim()) return;
    setValidatingTarget(true);
    setTargetValidationError(null);
    setValidatedTargetCourse(null);
    setTargetBackupJob(null);
    setBackupError(null);
    setEraseWithoutBackupConfirmed(false);
    try {
      const result = await validateTransferTarget(sessionId, targetCourse);
      setValidatedTargetCourse(result.target_course);
    } catch (e) {
      setTargetValidationError(e instanceof Error ? e.message : "Failed to validate target Canvas course");
    } finally {
      setValidatingTarget(false);
    }
  }

  async function handleStartTargetBackup() {
    if (!targetCourse.trim()) return;
    setStartingBackup(true);
    setBackupError(null);
    setEraseWithoutBackupConfirmed(false);
    try {
      const result = await startTransferTargetBackup(sessionId, targetCourse);
      setTargetBackupJob(result.job);
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Failed to start target course backup");
    } finally {
      setStartingBackup(false);
    }
  }

  function handleOpenTransferModal() {
    if (!selectedMode) return;
    setTargetValidationError(null);
    setJobError(null);
    if (!activeJobIsRunning) {
      setActiveJob(null);
    }
    if (selectedMode === "same_course") {
      setSameCourseModalOpen(true);
    } else {
      setTargetModalOpen(true);
    }
  }

  async function handleStartTransferJob() {
    if (!selectedMode) return;
    if (selectedMode !== "same_course" && !targetCourse.trim()) return;
    setStartingJob(true);
    setJobError(null);
    try {
      const result = await startTransferJob(sessionId, {
        mode: selectedMode,
        canvas_url: selectedMode === "same_course" ? undefined : targetCourse,
        erase_first: eraseFirst,
        target_backup_job_id: eraseFirst && targetBackupJob?.status === "succeeded" ? targetBackupJob.id : undefined,
        erase_without_backup_confirmed: eraseFirst ? eraseWithoutBackupConfirmed : false,
      });
      setActiveJob(result.job);
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Failed to start Transfer job");
    } finally {
      setStartingJob(false);
    }
  }

  if (loading && !readiness) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl bg-surface-container-lowest p-8 text-sm text-on-surface-variant ghost-border">
        <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading Transfer readiness...</span>
      </div>
    );
  }

  if (error && !readiness) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl bg-error-container p-8 text-sm text-on-error-container">
        <p className="font-bold">Transfer readiness failed</p>
        <p className="mt-2">{error}</p>
        <button
          type="button"
          onClick={() => void loadReadiness()}
          className="mt-4 rounded-xl bg-surface-container-lowest px-4 py-2 text-xs font-bold text-on-surface"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!readiness) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-primary">Transfer Management</h2>
          <p className="mt-1 text-lg text-on-surface-variant">Orchestrate generated and curated content across Canvas environments.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadReadiness()}
          disabled={refreshInProgress}
          className="inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high disabled:cursor-wait disabled:opacity-70"
        >
          {refreshInProgress ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {refreshInProgress ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {readiness.session.is_course_creation_export ? (
        <section className="flex items-start gap-3 rounded-xl bg-secondary-container/25 p-4 text-sm text-on-surface-variant">
          <ShieldCheck size={18} className="mt-0.5 flex-none text-secondary" />
          <p>
            This course was generated in Canvas Create and exported into Canvas Clean. Review edits here first, then push to a selected Canvas target course when Transfer write jobs are enabled.
          </p>
        </section>
      ) : null}

      <TransferModeCards
        modes={readiness.modes}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
      />

      {selectedModeRequiresTarget ? (
        <section className="rounded-xl bg-surface-container-lowest p-5 ghost-border">
          <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant" htmlFor="target-course">
            Target Canvas Course
          </label>
          <div className="mt-2 flex flex-col gap-2 md:flex-row">
            <input
              id="target-course"
              value={targetCourse}
              onChange={(event) => {
                setTargetCourse(event.target.value);
                setValidatedTargetCourse(null);
                setTargetValidationError(null);
                setTargetBackupJob(null);
                setBackupError(null);
                setEraseWithoutBackupConfirmed(false);
              }}
              placeholder="https://canvas.asu.edu/courses/..."
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void handleValidateTargetCourse()}
              disabled={validatingTarget || !targetCourse.trim()}
              className="inline-flex flex-none items-center justify-center gap-2 rounded-xl bg-surface-container-low px-4 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              {validatingTarget ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
              Validate
            </button>
          </div>
          {targetValidationError ? (
            <p className="mt-2 text-xs font-semibold text-error">{targetValidationError}</p>
          ) : null}
          {validatedTargetCourse ? (
            <div className="mt-3 rounded-xl bg-surface-container-low p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 flex-none text-[#446D12]" />
                <div className="min-w-0">
                  <p className="font-bold text-on-surface">{validatedTargetCourse.name}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Canvas course {validatedTargetCourse.canvas_course_id}
                    {validatedTargetCourse.term_name ? ` | ${validatedTargetCourse.term_name}` : ""}
                    {validatedTargetCourse.workflow_state ? ` | ${validatedTargetCourse.workflow_state}` : ""}
                  </p>
                  {validatedTargetCourse.credential_base_url && validatedTargetCourse.credential_base_url !== validatedTargetCourse.canvas_base_url ? (
                    <p className="mt-1 text-[10px] text-on-surface-variant">
                      Token matched through {validatedTargetCourse.credential_base_url}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <TransferSummaryPanel readiness={readiness} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <PendingContentList items={readiness.pending_items} />
          {!selectedModeIsSameCourse && !selectedModeIsCopyCourse ? <TransferIssueList items={readiness.transfer_issues ?? []} /> : null}
          <ModuleOperationList operations={readiness.module_operations} />
          <DeletionCandidateList items={readiness.deletion_items} />
        </div>

        <aside className="h-fit rounded-xl bg-surface-container-lowest p-5 ghost-border">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Readiness</p>
          <h3 className="mt-2 font-headline text-lg font-bold text-on-surface">Transfer is staged for review</h3>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Transferable items</dt>
              <dd className="font-bold text-on-surface">{targetReadyItemCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Referenced files/images</dt>
              <dd className="font-bold text-on-surface">{referencedFileCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Pending changes</dt>
              <dd className="font-bold text-on-surface">{sameCourseReadyItemCount}</dd>
            </div>
            {!selectedModeIsSameCourse ? (
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Known exceptions</dt>
                <dd className="font-bold text-on-surface">{readiness.summary.transfer_issue_count ?? 0}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Generated drafts</dt>
              <dd className="font-bold text-on-surface">{readiness.summary.generated_content_count}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Source course</dt>
              <dd className="max-w-[190px] truncate text-right font-bold text-on-surface">
                {readiness.source_course?.name ?? readiness.source_course?.canvas_course_id ?? "Not connected"}
              </dd>
            </div>
          </dl>
          <div className="mt-5 rounded-xl bg-surface-container-low p-4 text-xs leading-relaxed text-on-surface-variant">
            <span className="mb-2 inline-flex items-center gap-2 font-bold text-on-surface">
              <AlertTriangle size={14} /> {actionDisabledReason ? "Transfer check" : selectedModeIsSameCourse ? "Ready for same-course push" : "Ready for target transfer"}
            </span>
            <p>{actionDisabledReason ?? "Open the Transfer modal to start the Canvas write job for modules, supported content, placements, and referenced files/images."}</p>
          </div>
        </aside>
      </div>

      <section className="sticky bottom-8 z-30">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-2xl border border-primary/20 bg-white/90 p-4 shadow-2xl backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold text-on-surface">
              {selectedModeIsCopyCourse ? "Ready to copy connected source course" : `Ready to transfer ${displayedReadyItemCount} items`}
            </p>
            <p className="mt-1 text-[10px] text-on-surface-variant">
              {selectedMode === "same_course" ? "Target: same Canvas course" : selectedModeIsCopyCourse ? "Canvas-native source course copy" : targetCourse.trim() || "Target course not selected"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="rounded-xl px-5 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high"
            >
              Preview All
            </button>
            <button
              type="button"
              onClick={handleOpenTransferModal}
              disabled={!selectedMode || (!selectedModeIsCopyCourse && !displayedReadyItemCount) || activeJobIsRunning}
              title={actionDisabledReason ?? (selectedMode === "same_course" ? "Push edits to the source Canvas course" : "Configure target Transfer")}
              className="btn-primary-gradient rounded-xl px-6 py-2 text-xs font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedMode === "same_course" ? "Push to Same Course" : "Configure Transfer"}
            </button>
          </div>
        </div>
      </section>

      {targetModalOpen && selectedMode && selectedMode !== "same_course" ? (
        <TransferTargetModal
          mode={selectedMode}
          readiness={readiness}
          targetCourseUrl={targetCourse}
          targetCourse={validatedTargetCourse}
          validating={validatingTarget}
          validationError={targetValidationError}
          eraseFirst={eraseFirst}
          onTargetCourseUrlChange={(value) => {
            setTargetCourse(value);
            setValidatedTargetCourse(null);
            setTargetValidationError(null);
            setTargetBackupJob(null);
            setBackupError(null);
            setEraseWithoutBackupConfirmed(false);
          }}
          onEraseFirstChange={(value) => {
            setEraseFirst(value);
            if (!value) setEraseWithoutBackupConfirmed(false);
          }}
          eraseWithoutBackupConfirmed={eraseWithoutBackupConfirmed}
          onEraseWithoutBackupConfirmedChange={setEraseWithoutBackupConfirmed}
          onValidate={() => void handleValidateTargetCourse()}
          onStartBackup={() => void handleStartTargetBackup()}
          onStart={() => void handleStartTransferJob()}
          onClose={() => setTargetModalOpen(false)}
          starting={startingJob}
          startingBackup={startingBackup}
          backupJob={targetBackupJob}
          backupError={backupError}
          job={activeJob}
          jobError={jobError}
        />
      ) : null}

      {sameCourseModalOpen && selectedMode === "same_course" ? (
        <TransferSameCourseModal
          readiness={readiness}
          onStart={() => void handleStartTransferJob()}
          onClose={() => setSameCourseModalOpen(false)}
          starting={startingJob}
          job={activeJob}
          jobError={jobError}
        />
      ) : null}

      {previewOpen ? (
        <TransferPreviewModal
          readiness={readiness}
          selectedMode={selectedMode}
          targetReadyItemCount={targetReadyItemCount}
          sameCourseReadyItemCount={sameCourseReadyItemCount}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TransferSameCourseModal({
  readiness,
  onStart,
  onClose,
  starting,
  job,
  jobError,
}: {
  readiness: TransferReadiness;
  onStart: () => void;
  onClose: () => void;
  starting: boolean;
  job: TransferJob | null;
  jobError: string | null;
}) {
  const jobProgress = Math.round(((job?.result?.progress ?? 0) as number) * 100);
  const jobEvents = job?.result?.events ?? [];
  const jobIssues = jobEvents.filter((event) => event.status === "warning" || event.status === "error");
  const jobIsRunning = job ? ["queued", "running", "retrying"].includes(job.status) : false;
  const jobSucceeded = job?.status === "succeeded";
  const jobFailed = job?.status === "failed";
  const sourceCourse = readiness.source_course;
  const sameCourseModuleCreateCount = readiness.summary.same_course_module_create_count ?? 0;
  const sameCourseModuleOperationCount = readiness.summary.same_course_module_operation_count ?? 0;
  const sameCourseModuleItemOperationCount = readiness.summary.same_course_module_item_operation_count ?? 0;
  const sameCourseEditCount = readiness.summary.same_course_push_count ?? 0;
  const sameCourseCreateCount = readiness.summary.same_course_create_count ?? 0;
  const sameCourseDeleteCount = readiness.summary.same_course_delete_count ?? 0;
  const sameCourseCount = readiness.summary.same_course_action_count ?? readiness.summary.same_course_push_count ?? readiness.summary.ready_item_count;
  const canvasCourseHref = sourceCourse?.canvas_base_url && sourceCourse.canvas_course_id
    ? `${sourceCourse.canvas_base_url}/courses/${sourceCourse.canvas_course_id}`
    : "";
  const summary = job?.result?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl ghost-border">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 px-8 py-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck size={28} />
            </div>
            <div>
              <h3 className="font-headline text-2xl font-extrabold text-on-surface">Push to Same Course</h3>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                Update edited Canvas pages, assignments, discussions, classic quizzes/questions, and apply explicit deletion decisions in the connected source course.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-6">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Source Course</p>
            <p className="mt-2 font-bold text-on-surface">{sourceCourse?.name ?? sourceCourse?.canvas_course_id ?? "Connected source course"}</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              This slice updates existing content bodies, classic quizzes/questions, module structure, and explicit deletion decisions.
            </p>
          </div>

          <div className="rounded-2xl border border-error-container/50 bg-error-container/30 p-4">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-none text-on-error-container" />
              <p className="text-sm leading-relaxed text-on-error-container">
                This will create <strong>{sameCourseModuleCreateCount} module(s)</strong>, apply <strong>{sameCourseModuleOperationCount} module operation(s)</strong>, create <strong>{sameCourseCreateCount} new supported item(s)</strong>, push <strong>{sameCourseEditCount} supported content edit(s)</strong>, apply <strong>{sameCourseModuleItemOperationCount} module item operation(s)</strong>, and apply <strong>{sameCourseDeleteCount} deletion decision(s)</strong> in the original Canvas course.
              </p>
            </div>
          </div>

          {jobError ? (
            <div className="rounded-xl bg-error-container p-4 text-sm text-on-error-container">
              {jobError}
            </div>
          ) : null}

          {job ? (
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4">
              <div className="flex items-center gap-3">
                {jobIsRunning ? <Loader2 size={16} className="animate-spin text-primary" /> : jobSucceeded ? <CheckCircle2 size={16} className="text-[#446D12]" /> : <AlertTriangle size={16} className="text-error" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-on-surface">
                    {jobIsRunning ? "Same-course push running" : jobSucceeded ? "Same-course push complete" : jobFailed ? "Same-course push failed" : `Same-course push ${job.status}`}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${jobProgress}%` }} />
                  </div>
                </div>
                <span className="text-xs font-bold text-on-surface-variant">{jobProgress}%</span>
              </div>
              {summary && !jobIsRunning ? (
                <p className="mt-3 text-xs text-on-surface-variant">
                  {summary.modules_created ?? 0} modules, {summary.module_operations_applied ?? 0} module operations, {summary.items_created ?? 0} created, {summary.items_updated ?? 0} updated, {summary.module_item_operations_applied ?? 0} module item operations, {summary.items_deleted ?? 0} deleted, {summary.placements_created ?? 0} placements, {summary.pages_updated ?? 0} pages updated, {summary.assignments_updated ?? 0} assignments updated, {summary.discussions_updated ?? 0} discussions updated, {summary.quizzes_updated ?? 0} quizzes updated
                  {summary.quiz_questions_created ? `, ${summary.quiz_questions_created} quiz questions created` : ""}
                  {summary.quiz_questions_updated ? `, ${summary.quiz_questions_updated} quiz questions updated` : ""}
                  {summary.quiz_questions_deleted ? `, ${summary.quiz_questions_deleted} quiz questions deleted` : ""}
                  {summary.protected_skipped ? `, ${summary.protected_skipped} protected` : ""}
                  {summary.items_skipped ? `, ${summary.items_skipped} skipped` : ""}
                  {summary.warnings ? `, ${summary.warnings} warnings` : ""}
                </p>
              ) : null}
              {jobEvents.length ? (
                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl bg-surface-container-lowest p-3">
                  {jobEvents.slice(-12).map((event, index) => (
                    <p key={`${event.at ?? "event"}-${index}`} className={`text-xs ${
                      event.status === "error" ? "text-error" : event.status === "warning" ? "text-secondary" : event.status === "done" ? "text-[#446D12]" : "text-on-surface-variant"
                    }`}>
                      {event.message}
                    </p>
                  ))}
                </div>
              ) : null}
              {jobIssues.length && !jobIsRunning ? (
                <div className="mt-3 rounded-xl border border-secondary/30 bg-secondary-container/15 p-3">
                  <p className="text-xs font-bold text-on-surface">Same-course push issues</p>
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {jobIssues.map((event, index) => (
                      <p key={`${event.at ?? "issue"}-${index}`} className={`text-xs ${
                        event.status === "error" ? "text-error" : "text-secondary"
                      }`}>
                        {event.message}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              {!jobIsRunning ? <TransferJobReportPanel report={job.result?.report} /> : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-outline-variant/20 bg-surface-container-low/50 px-8 py-6">
          {jobSucceeded && canvasCourseHref ? (
            <a
              href={canvasCourseHref}
              target="_blank"
              rel="noreferrer"
              className="btn-primary-gradient flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold text-on-primary"
            >
              Open Course in Canvas
            </a>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={starting || jobIsRunning || sameCourseCount === 0}
              className="btn-primary-gradient flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting || jobIsRunning ? <Loader2 size={16} className="animate-spin" /> : null}
              {jobFailed ? "Retry Same-Course Push" : "Confirm Same-Course Push"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            Close and Return to Transfer
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferPreviewModal({
  readiness,
  selectedMode,
  targetReadyItemCount,
  sameCourseReadyItemCount,
  onClose,
}: {
  readiness: TransferReadiness;
  selectedMode: TransferMode | null;
  targetReadyItemCount: number;
  sameCourseReadyItemCount: number;
  onClose: () => void;
}) {
  const issues = readiness.transfer_issues ?? [];
  const showTargetExceptions = selectedMode !== "same_course" && selectedMode !== "copy_course";
  const isCopyMode = selectedMode === "copy_course";
  const modeLabel = selectedMode === "same_course"
    ? "Same course push"
    : selectedMode === "copy_course"
      ? "Copy to target course"
      : "Push to target course";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl ghost-border">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 px-8 py-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Transfer Preview</p>
            <h3 className="mt-1 font-headline text-2xl font-extrabold text-on-surface">{modeLabel}</h3>
            <p className="mt-1 text-sm text-on-surface-variant">
              {showTargetExceptions
                ? "Review the current transfer payload and known exceptions before configuring the Canvas job."
                : isCopyMode
                  ? "Review the connected source course before starting a Canvas-native course copy."
                : "Review pending edits and deletion decisions before pushing back to the source Canvas course."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low"
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8 py-6">
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {isCopyMode ? <PreviewMetric label="Source modules" value={readiness.summary.module_count} /> : <PreviewMetric label="Target payload" value={targetReadyItemCount} />}
            <PreviewMetric label={isCopyMode ? "Source items" : "Pending changes"} value={isCopyMode ? readiness.summary.module_item_count : sameCourseReadyItemCount} />
            <PreviewMetric label={isCopyMode ? "Synced files" : "Referenced files/images"} value={isCopyMode ? readiness.summary.content_counts.file : readiness.summary.referenced_file_count ?? 0} />
            {showTargetExceptions ? <PreviewMetric label="Known exceptions" value={readiness.summary.transfer_issue_count ?? 0} /> : null}
          </div>

          <PreviewSection title="Transferable Content" empty="No modified or generated content is currently ready for transfer.">
            {readiness.pending_items.map((item) => (
              <PreviewRow
                key={item.id}
                title={item.title}
                meta={`${item.content_type}${item.module_name ? ` | ${item.module_name}` : ""}`}
                detail={item.badges.join(", ")}
              />
            ))}
          </PreviewSection>

          {showTargetExceptions ? (
            <PreviewSection title="Known Exceptions" empty="No known exceptions are expected for the current Transfer slice.">
              {issues.map((issue) => (
                <PreviewRow
                  key={issue.id}
                  title={issue.title}
                  meta={issue.content_type}
                  detail={`${issue.reason}${issue.impact ? ` ${issue.impact}` : ""}`}
                  tone={issue.severity === "error" ? "error" : issue.severity === "info" ? "info" : "warning"}
                />
              ))}
            </PreviewSection>
          ) : null}

          <PreviewSection title="Module Operations" empty="No staged module operations are waiting for transfer.">
            {readiness.module_operations.map((operation) => (
              <PreviewRow
                key={operation.id}
                title={operation.title || operation.operation_type || "Module operation"}
                meta={operation.operation_type || "operation"}
                detail={operation.detail || undefined}
              />
            ))}
          </PreviewSection>

          <PreviewSection title="Deletion Review" empty="No deletion candidates are currently staged for transfer.">
            {readiness.deletion_items.map((item) => (
              <PreviewRow
                key={item.id}
                title={item.title}
                meta={item.content_type}
                detail={item.reason}
                tone="error"
              />
            ))}
          </PreviewSection>
        </div>

        <div className="border-t border-outline-variant/20 bg-surface-container-low/50 px-8 py-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-surface-container-low px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4">
      <p className="font-headline text-2xl font-black text-on-surface">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase text-on-surface-variant">{label}</p>
    </div>
  );
}

function PreviewSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="space-y-3">
      <h4 className="font-headline text-lg font-bold text-on-surface">{title}</h4>
      {items.length ? (
        <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ghost-border">
          {items.map((child, index) => (
            <div key={index} className={index ? "border-t border-outline-variant/10" : ""}>{child}</div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-surface-container-low p-4 text-sm text-on-surface-variant">{empty}</div>
      )}
    </section>
  );
}

function PreviewRow({
  title,
  meta,
  detail,
  tone = "default",
}: {
  title: string;
  meta: string;
  detail?: string | null;
  tone?: "default" | "info" | "warning" | "error";
}) {
  const toneClass = tone === "error" ? "text-error" : tone === "warning" ? "text-secondary" : "text-on-surface-variant";
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-on-surface">{title}</p>
          {detail ? <p className={`mt-1 text-xs ${toneClass}`}>{detail}</p> : null}
        </div>
        <span className="flex-none rounded-full bg-surface-container-high px-2 py-0.5 text-[9px] font-bold uppercase text-on-surface-variant">
          {meta}
        </span>
      </div>
    </div>
  );
}
