/**
 * Push/copy target confirmation modal.
 *
 * The enabled target write path creates modules, supported content, referenced
 * files, and module placements in the target Canvas course.
 */

import { AlertTriangle, CheckCircle2, Copy, DownloadCloud, ExternalLink, Loader2, Target, X } from "lucide-react";
import type { TransferJob, TransferJobEvent, TransferMode, TransferReadiness, TransferTargetCourse } from "../types";
import TransferJobReportPanel from "./TransferJobReport";

type TransferTargetModalProps = {
  mode: TransferMode;
  readiness: TransferReadiness;
  targetCourseUrl: string;
  targetCourse: TransferTargetCourse | null;
  validating: boolean;
  validationError: string | null;
  eraseFirst: boolean;
  eraseWithoutBackupConfirmed: boolean;
  onTargetCourseUrlChange: (value: string) => void;
  onEraseFirstChange: (value: boolean) => void;
  onEraseWithoutBackupConfirmedChange: (value: boolean) => void;
  onValidate: () => void;
  onStartBackup: () => void;
  onStart: () => void;
  onClose: () => void;
  starting: boolean;
  startingBackup: boolean;
  backupJob: TransferJob | null;
  backupError: string | null;
  job: TransferJob | null;
  jobError: string | null;
};

function modeCopy(mode: TransferMode) {
  if (mode === "copy_course") {
    return {
      title: "Copy to Target Course",
      description: "Use Canvas course copy to clone the connected source Canvas course into another shell.",
      icon: Copy,
      primaryLabel: "Copy to Target Course",
      info: "Copy mode uses Canvas' native content migration. It copies the connected source course, not the local Canvas Clean draft payload.",
    };
  }
  return {
    title: "Push to Target Course",
    description: "Recreate reviewed modules and editable content in another Canvas course.",
    icon: Target,
    primaryLabel: "Push to Target Course",
    info: "Push mode will create reviewed modules and content items in the target course using your Canvas Clean drafts.",
  };
}

function issueEvents(events: TransferJobEvent[]) {
  return events.filter((event) => event.status === "warning" || event.status === "error");
}

export default function TransferTargetModal({
  mode,
  readiness,
  targetCourseUrl,
  targetCourse,
  validating,
  validationError,
  eraseFirst,
  eraseWithoutBackupConfirmed,
  onTargetCourseUrlChange,
  onEraseFirstChange,
  onEraseWithoutBackupConfirmedChange,
  onValidate,
  onStartBackup,
  onStart,
  onClose,
  starting,
  startingBackup,
  backupJob,
  backupError,
  job,
  jobError,
}: TransferTargetModalProps) {
  const copy = modeCopy(mode);
  const Icon = copy.icon;
  const isCopyMode = mode === "copy_course";
  const moduleCount = readiness.summary.module_count;
  const itemCount = readiness.summary.transferable_content_count;
  const fileCount = readiness.summary.referenced_file_count ?? 0;
  const jobProgress = Math.round(((job?.result?.progress ?? 0) as number) * 100);
  const jobEvents = job?.result?.events ?? [];
  const jobIssues = issueEvents(jobEvents);
  const jobIsRunning = job ? ["queued", "running", "retrying"].includes(job.status) : false;
  const jobSucceeded = job?.status === "succeeded";
  const jobFailed = job?.status === "failed";
  const backupIsRunning = backupJob ? ["queued", "running", "retrying"].includes(backupJob.status) : false;
  const backupSucceeded = backupJob?.status === "succeeded";
  const backupProgress = Math.round(((backupJob?.result?.progress ?? 0) as number) * 100);
  const backupDownloadUrl = backupSucceeded ? backupJob?.result?.summary?.backup_download_url : "";
  const backupFilename = backupJob?.result?.summary?.backup_filename ?? "target-course-backup.imscc";
  const eraseGateSatisfied = !eraseFirst || Boolean(backupDownloadUrl) || eraseWithoutBackupConfirmed;
  const transferStarted = Boolean(job);
  const primaryLabel = jobFailed ? "Retry Transfer" : copy.primaryLabel;
  const startLabel = eraseFirst ? `Erase Target and ${isCopyMode ? "Copy" : "Transfer"}` : primaryLabel;
  const secondaryLabel = transferStarted ? "Close and Return to Transfer" : "Cancel and Return to Transfer";
  const canvasCourseHref = targetCourseUrl.trim()
    || (targetCourse ? `${targetCourse.canvas_base_url}/courses/${targetCourse.canvas_course_id}` : "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl ghost-border">
        <div className="border-b border-outline-variant/20 px-8 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon size={28} />
              </div>
              <div>
                <h3 className="font-headline text-2xl font-extrabold text-on-surface">{copy.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{copy.description}</p>
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
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-6">
          <div className="rounded-xl border-l-4 border-primary bg-surface-container-low p-4 text-sm leading-relaxed text-on-surface-variant">
            {copy.info}
          </div>

          <div className="space-y-2">
            <label className="ml-1 block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant" htmlFor="transfer-target-course-url">
              Target Course URL
            </label>
            <input
              id="transfer-target-course-url"
              value={targetCourseUrl}
              onChange={(event) => onTargetCourseUrlChange(event.target.value)}
              disabled={jobIsRunning || jobSucceeded}
              placeholder="https://canvas.asu.edu/courses/..."
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm font-medium text-on-surface outline-none focus:border-secondary focus:ring-4 focus:ring-secondary-container/20 disabled:cursor-not-allowed disabled:opacity-70"
            />
            <p className="ml-1 text-[10px] text-on-surface-variant">Enter the full destination URL for the course you want to populate.</p>
          </div>

          <button
            type="button"
            onClick={onValidate}
            disabled={validating || !targetCourseUrl.trim() || jobIsRunning || jobSucceeded}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
          >
            {validating ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
            Validate Target Course
          </button>

          {validationError ? (
            <div className="rounded-xl bg-error-container p-4 text-sm text-on-error-container">
              {validationError}
            </div>
          ) : null}

          {targetCourse ? (
            <div className="rounded-xl bg-surface-container-low p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 flex-none text-[#446D12]" />
                <div className="min-w-0">
                  <p className="font-bold text-on-surface">{targetCourse.name}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Canvas course {targetCourse.canvas_course_id}
                    {targetCourse.term_name ? ` | ${targetCourse.term_name}` : ""}
                    {targetCourse.workflow_state ? ` | ${targetCourse.workflow_state}` : ""}
                  </p>
                  {targetCourse.credential_base_url && targetCourse.credential_base_url !== targetCourse.canvas_base_url ? (
                    <p className="mt-1 text-[10px] text-on-surface-variant">
                      Token matched through {targetCourse.credential_base_url}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-error-container/50 bg-error-container/30 p-4">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-none text-on-error-container" />
              {isCopyMode ? (
                <p className="text-sm leading-relaxed text-on-error-container">
                  Canvas will copy the connected source course into the validated target course using the Canvas content migration API.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-on-error-container">
                  This transfer will create <strong>{moduleCount} modules</strong>, create <strong>{itemCount} Canvas content items</strong>, migrate <strong>{fileCount} referenced files/images</strong>, and place supported items into modules, including supported classic quizzes and quiz questions.
                </p>
              )}
            </div>
          </div>

          {!isCopyMode && readiness.transfer_issues?.length ? (
            <div className="rounded-2xl border border-secondary/30 bg-secondary-container/15 p-4">
              <p className="text-sm font-bold text-on-surface">Known exceptions before transfer</p>
              <div className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                {readiness.transfer_issues.slice(0, 8).map((issue) => (
                  <div key={issue.id} className="text-xs text-on-surface-variant">
                    <span className="font-bold text-on-surface">{issue.title}</span>
                    <span> - {issue.reason}</span>
                  </div>
                ))}
              </div>
              {readiness.transfer_issues.length > 8 ? (
                <p className="mt-2 text-[10px] text-on-surface-variant">
                  {readiness.transfer_issues.length - 8} more exceptions are listed on the Transfer page.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-outline-variant/20 p-4">
            <input
              type="checkbox"
              checked={eraseFirst}
              onChange={(event) => onEraseFirstChange(event.target.checked)}
              disabled={jobIsRunning || jobSucceeded}
              className="mt-0.5 h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary/20"
            />
            <span>
              <span className="block text-sm font-semibold text-on-surface">Erase target course first</span>
              <span className="mt-1 block text-xs text-on-surface-variant">
                Permanently delete existing target modules and content before transfer. Exporting an IMSCC backup is recommended.
              </span>
            </span>
          </label>

          {eraseFirst ? (
            <div className="space-y-3 rounded-2xl border border-error/30 bg-error-container/25 p-4">
              <div className="flex gap-3">
                <AlertTriangle size={18} className="mt-0.5 flex-none text-on-error-container" />
                <div>
                  <p className="text-sm font-bold text-on-error-container">Erase safeguard</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-error-container">
                Existing target modules, pages, assignments, discussions, quizzes, and files will be deleted before {isCopyMode ? "the source course is copied" : "new content is created"}.
                  </p>
                </div>
              </div>

              {backupJob ? (
                <div className="rounded-xl bg-surface-container-lowest p-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-on-surface">
                    {backupIsRunning ? <Loader2 size={14} className="animate-spin text-primary" /> : backupSucceeded ? <CheckCircle2 size={14} className="text-[#446D12]" /> : <AlertTriangle size={14} className="text-error" />}
                    {backupIsRunning ? "Generating target backup" : backupSucceeded ? "Target backup ready" : "Target backup failed"}
                    {backupIsRunning ? <span className="ml-auto text-on-surface-variant">{backupProgress}%</span> : null}
                  </div>
                  {backupIsRunning ? (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${backupProgress}%` }} />
                    </div>
                  ) : null}
                  {backupDownloadUrl ? (
                    <a
                      href={backupDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface hover:bg-surface-container-high"
                    >
                      <DownloadCloud size={14} />
                      Download {backupFilename}
                    </a>
                  ) : null}
                  {backupJob.error_message && !backupIsRunning ? (
                    <p className="mt-2 text-xs text-error">{backupJob.error_message}</p>
                  ) : null}
                </div>
              ) : null}

              {backupError ? (
                <p className="rounded-xl bg-error-container p-3 text-xs text-on-error-container">{backupError}</p>
              ) : null}

              <button
                type="button"
                onClick={onStartBackup}
                disabled={!targetCourse || startingBackup || backupIsRunning || jobIsRunning || jobSucceeded}
                className="inline-flex items-center gap-2 rounded-xl bg-surface-container-lowest px-4 py-2 text-xs font-bold text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingBackup || backupIsRunning ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
                {backupSucceeded ? "Generate New Backup" : "Generate IMSCC Backup"}
              </button>

              <label className="flex items-start gap-3 rounded-xl bg-surface-container-lowest p-3">
                <input
                  type="checkbox"
                  checked={eraseWithoutBackupConfirmed}
                  onChange={(event) => onEraseWithoutBackupConfirmedChange(event.target.checked)}
                  disabled={backupIsRunning || jobIsRunning || jobSucceeded}
                  className="mt-0.5 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
                />
                <span className="text-xs leading-relaxed text-on-surface-variant">
                  Proceed without a target backup. I understand the existing target course content will be permanently deleted.
                </span>
              </label>
            </div>
          ) : null}

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
                    {jobIsRunning ? (isCopyMode ? "Course copy running" : "Transfer running") : jobSucceeded ? (isCopyMode ? "Course copy complete" : "Transfer complete") : jobFailed ? (isCopyMode ? "Course copy failed" : "Transfer failed") : `${isCopyMode ? "Course copy" : "Transfer"} ${job.status}`}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${jobProgress}%` }} />
                  </div>
                </div>
                <span className="text-xs font-bold text-on-surface-variant">{jobProgress}%</span>
              </div>
              {job.result?.summary && !jobIsRunning ? (
                <p className="mt-3 text-xs text-on-surface-variant">
                  {isCopyMode ? `Canvas migration ${job.result.summary.migration_id ?? "completed"}`
                    : `${job.result.summary.modules_created ?? 0} modules, ${job.result.summary.pages_created ?? 0} pages, ${job.result.summary.assignments_created ?? 0} assignments, ${job.result.summary.discussions_created ?? 0} discussions, ${job.result.summary.quizzes_created ?? 0} quizzes, ${job.result.summary.placements_created ?? job.result.summary.page_placements_created ?? 0} placements`}
                  {!isCopyMode && job.result.summary.quiz_questions_created ? `, ${job.result.summary.quiz_questions_created} quiz questions` : ""}
                  {!isCopyMode && job.result.summary.linked_items_created ? `, ${job.result.summary.linked_items_created} linked-only items` : ""}
                  {!isCopyMode && job.result.summary.files_migrated ? `, ${job.result.summary.files_migrated} files` : ""}
                  {job.result.summary.target_items_erased ? `, ${job.result.summary.target_items_erased} target items erased` : ""}
                  {job.result.summary.items_skipped ? `, ${job.result.summary.items_skipped} skipped` : ""}
                  {job.result.summary.warnings ? `, ${job.result.summary.warnings} warnings` : ""}
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
                  <p className="text-xs font-bold text-on-surface">Transfer issues report</p>
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
              className="btn-primary-gradient flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-on-primary"
            >
              <ExternalLink size={16} />
              Open Course in Canvas
            </a>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={!targetCourse || starting || jobIsRunning || (!isCopyMode && itemCount === 0) || !eraseGateSatisfied}
              className="btn-primary-gradient flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting || jobIsRunning ? <Loader2 size={16} className="animate-spin" /> : null}
              {startLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
