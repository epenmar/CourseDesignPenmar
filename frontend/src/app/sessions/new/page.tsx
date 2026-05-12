"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const ACCEPTED_CANVAS_HOSTS = new Set(["canvas.asu.edu", "asu.instructure.com"]);

const SESSION_TYPES = [
  { value: "curate",   label: "Curate",   desc: "Edit and health-check a Canvas course" },
  { value: "create",   label: "Create",   desc: "Build a course from documents" },
  { value: "document", label: "Document", desc: "Remediate standalone PDFs" },
] as const;

type SessionType = typeof SESSION_TYPES[number]["value"];

type CoursePreview = {
  canvas_base_url: string;
  canvas_course_id: string;
  course_name: string;
  course_code: string | null;
  workflow_state: string | null;
  term_name: string | null;
  start_at: string | null;
  end_at: string | null;
};

type CredentialStatus = {
  has_credential: boolean;
  active?: boolean;
  expires_at?: string;
  days_remaining?: number;
  expired?: boolean;
  warning?: boolean;
  validation_status?: "validated" | "missing" | "expired" | "rejected" | "unverified";
  validation_message?: string;
};

function parseCanvasBaseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (!ACCEPTED_CANVAS_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function canvasUrlValidationMessage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return "Use a full HTTPS Canvas course URL.";
    if (!ACCEPTED_CANVAS_HOSTS.has(url.hostname.toLowerCase())) {
      return "Use a Canvas course URL from canvas.asu.edu or asu.instructure.com.";
    }
    if (!/\/courses\/\d+(?:\/|$)/.test(url.pathname)) {
      return "Use a Canvas course URL that includes /courses/<course id>.";
    }
    return null;
  } catch {
    return "Enter a valid Canvas course URL.";
  }
}

function credentialStatusMessage(status: CredentialStatus | null) {
  if (!status) return null;
  if (status.validation_status === "rejected") return "Canvas rejected the stored token. Enter a new PAT to continue.";
  if (status.validation_status === "unverified") return status.validation_message ?? "Unable to verify the stored Canvas token right now.";
  if (!status.active || status.expired) return "The stored Canvas token is no longer active. Enter a new PAT to continue.";
  const days = status.days_remaining ?? 0;
  if (days <= 0) return "Using the active Canvas token for today.";
  if (days === 1) return "Using the active Canvas token. It expires in 1 day.";
  return `Using the active Canvas token. It expires in ${days} days.`;
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 && body.detail === "Not Found") {
    return `${fallback}. The configured API (${API_URL}) does not have the latest Canvas sync routes yet. Redeploy or restart the FastAPI backend, then try again.`;
  }
  return body.detail ?? fallback;
}

export default function NewSessionPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [sessionType, setSessionType] = useState<SessionType>("curate");
  const [sessionName, setSessionName] = useState("");
  const [canvasUrl, setCanvasUrl] = useState("");
  const [pat, setPat] = useState("");
  const [preview, setPreview] = useState<CoursePreview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [creatingStandalone, setCreatingStandalone] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [checkingCredential, setCheckingCredential] = useState(false);
  const [showPatOverride, setShowPatOverride] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasBaseUrl = useMemo(() => parseCanvasBaseUrl(canvasUrl), [canvasUrl]);
  const canvasUrlError = useMemo(() => canvasUrlValidationMessage(canvasUrl), [canvasUrl]);
  const hasActiveCredential = Boolean(
    credentialStatus?.has_credential && credentialStatus.active && !credentialStatus.expired,
  );

  function handleCanvasUrlChange(value: string) {
    const nextBaseUrl = parseCanvasBaseUrl(value);
    setCanvasUrl(value);
    setPreview(null);
    setCredentialStatus(null);
    setCredentialError(null);
    setShowPatOverride(false);
    setCheckingCredential(Boolean(nextBaseUrl));
  }

  useEffect(() => {
    if (!canvasBaseUrl) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setCredentialError(null);

      void getAccessToken()
        .then(async (token) => {
          const params = new URLSearchParams({ canvas_base_url: canvasBaseUrl });
          const res = await fetch(`${API_URL}/canvas/credentials/status?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });

          if (!res.ok) {
            throw new Error(await parseApiError(res, "Failed to load Canvas token status"));
          }

          return await res.json() as CredentialStatus;
        })
        .then((status) => {
          if (cancelled) return;
          setCredentialStatus(status);
          if (status.has_credential && status.active && !status.expired) {
            setShowPatOverride(false);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setCredentialStatus(null);
          setCredentialError(e instanceof Error ? e.message : "Failed to load Canvas token status");
        })
        .finally(() => {
          if (!cancelled) setCheckingCredential(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [canvasBaseUrl]);

  const credentialMessage = credentialStatusMessage(credentialStatus);
  const needsPat = !hasActiveCredential && !pat.trim();
  const isStandaloneCreateSession = sessionType === "create";
  const isStandaloneDocumentSession = sessionType === "document";
  const isStandaloneSession = isStandaloneCreateSession || isStandaloneDocumentSession;

  async function handleCreateStandaloneSession() {
    setError(null);
    setCreatingStandalone(true);

    try {
      const defaultName = isStandaloneCreateSession ? "New Course Build" : "Standalone document remediation";
      const token = await getAccessToken();
      const createRes = await fetch(`${API_URL}/canvas/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          canvas_url: "",
          session_type: sessionType,
          session_name: sessionName.trim() || defaultName,
        }),
      });

      if (!createRes.ok) {
        throw new Error(await parseApiError(createRes, "Failed to create session"));
      }

      const { session_id } = await createRes.json() as { session_id: string };
      router.push(isStandaloneCreateSession ? `/sessions/${session_id}/create` : `/sessions/${session_id}/documents`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreatingStandalone(false);
    }
  }

  async function handleReviewCourse() {
    setError(null);
    setReviewing(true);

    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (pat.trim()) {
        headers["X-Canvas-Pat"] = pat.trim();
      }
      const res = await fetch(`${API_URL}/canvas/course-preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({ canvas_url: canvasUrl.trim() }),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to preview Canvas course"));
      }

      setPreview(await res.json() as CoursePreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setReviewing(false);
    }
  }

  async function handleConfirmAndPull() {
    if (!preview) return;

    setError(null);
    setConfirming(true);

    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (pat.trim()) {
        headers["X-Canvas-Pat"] = pat.trim();
      }
      const createRes = await fetch(`${API_URL}/canvas/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          canvas_url: `${preview.canvas_base_url}/courses/${preview.canvas_course_id}`,
          session_type: sessionType,
          session_name: sessionName.trim() || preview.course_name,
        }),
      });

      if (!createRes.ok) {
        throw new Error(await parseApiError(createRes, "Failed to create session"));
      }

      const { session_id } = await createRes.json() as { session_id: string };
      router.push(`/sessions/${session_id}/sync?start=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <section className="bg-surface-container-low rounded-xl p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-8 overflow-hidden">
        <div className="max-w-xl">
          <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-secondary mb-3">
            LMS Integration
          </p>
          <h2 className="font-headline text-4xl font-extrabold text-on-surface tracking-tight">
            Connect Your Canvas Course
          </h2>
          <p className="text-on-surface-variant text-sm mt-3 leading-relaxed">
            Preview the course record, confirm it is the right shell, then pull Canvas content into Curator.
          </p>
        </div>
        <div className="hidden lg:grid grid-cols-2 gap-3 w-64">
          {["Pages", "Modules", "Files", "Quizzes"].map((label) => (
            <div key={label} className="bg-surface-container-lowest rounded-xl p-4 ghost-border shadow-ambient">
              <p className="text-2xl mb-2">{label === "Pages" ? "▤" : label === "Modules" ? "☰" : label === "Files" ? "□" : "?"}</p>
              <p className="text-xs font-bold text-on-surface">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-6">
        <div className={`bg-surface-container-lowest rounded-xl p-8 ghost-border space-y-6 ${step === 2 ? "opacity-60 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center">1</div>
            <h3 className="font-headline font-bold text-lg text-on-surface">Session Details</h3>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-on-surface">Session Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SESSION_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setSessionType(t.value)}
                  className={`p-3 rounded-xl text-left transition-all border-2 ${
                    sessionType === t.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <p className="text-sm font-bold">{t.label}</p>
                  <p className="text-[11px] mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-on-surface">
              Session Name <span className="text-on-surface-variant font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. ENG 101 Spring 2026 Cleanup"
              className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-secondary-container/50 ghost-border"
            />
          </div>

          {error && step === 1 ? (
            <div className="bg-error-container text-on-error-container text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          ) : null}

          <button
            onClick={() => {
              if (isStandaloneSession) {
                void handleCreateStandaloneSession();
              } else {
                setStep(2);
              }
            }}
            disabled={creatingStandalone}
            className="btn-primary-gradient text-on-primary font-bold px-6 py-2.5 rounded-xl text-sm hover:opacity-90 active:scale-95 transition-all"
          >
            {creatingStandalone
              ? "Creating..."
              : isStandaloneCreateSession
                ? "Create Course Build Session ->"
                : isStandaloneDocumentSession
                  ? "Create Document Session ->"
                  : "Continue ->"}
          </button>
        </div>

        <aside className="bg-secondary-container rounded-xl p-6 flex flex-col justify-between text-on-secondary-container">
          <div>
            <div className="w-12 h-12 bg-white/50 rounded-xl flex items-center justify-center text-2xl mb-4">✦</div>
            <h4 className="font-headline font-bold text-lg mb-2">Curator Ready</h4>
            <p className="text-sm text-on-secondary-container/80 leading-snug">
              Confirmation protects against syncing the wrong Canvas course shell before the pull starts.
            </p>
          </div>
          <div className="mt-8 text-[10px] font-bold uppercase tracking-widest">
            Read-only pull · 7-day token
          </div>
        </aside>
      </div>

      <div className={`bg-surface-container-lowest rounded-xl p-8 ghost-border space-y-6 ${step === 1 ? "opacity-60 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ${step === 2 ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}>2</div>
          <h3 className="font-headline font-bold text-lg text-on-surface">Canvas Connection</h3>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-on-surface">Canvas Course URL</label>
          <input
            type="url"
            value={canvasUrl}
            onChange={(e) => handleCanvasUrlChange(e.target.value)}
            placeholder="https://canvas.asu.edu/courses/12345"
            className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-secondary-container/50 ghost-border"
          />
          <p className={`px-1 text-[11px] ${canvasUrlError ? "text-error" : "text-on-surface-variant"}`}>
            {canvasUrlError ?? "Accepted hosts: canvas.asu.edu and asu.instructure.com."}
          </p>
        </div>

        {canvasBaseUrl && (
          <div className="rounded-xl bg-surface-container-low px-4 py-3 text-xs text-on-surface-variant">
            {checkingCredential ? (
              <p>Checking for an active Canvas token…</p>
            ) : credentialError ? (
              <p>{credentialError}</p>
            ) : credentialMessage ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p>{credentialMessage}</p>
                {hasActiveCredential && !showPatOverride && (
                  <button
                    type="button"
                    onClick={() => setShowPatOverride(true)}
                    className="text-left text-secondary font-semibold hover:text-primary transition-colors"
                  >
                    Use a different PAT
                  </button>
                )}
              </div>
            ) : (
              <p>Enter a Canvas PAT to continue.</p>
            )}
          </div>
        )}

        {(!hasActiveCredential || showPatOverride) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-semibold text-on-surface">Canvas Personal Access Token</label>
              {hasActiveCredential && showPatOverride && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPatOverride(false);
                    setPat("");
                  }}
                  className="text-xs font-semibold text-secondary hover:text-primary transition-colors"
                >
                  Keep active token instead
                </button>
              )}
            </div>
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="Paste your Canvas PAT"
              className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-secondary-container/50 ghost-border font-mono"
            />
            <p className="text-[11px] text-on-surface-variant px-1">
              {hasActiveCredential
                ? "Entering a new PAT will replace the active stored token after confirmation."
                : "Stored encrypted only after confirmation. Generate in Canvas → Account → Settings → New Access Token."}
            </p>
          </div>
        )}

        {error && (
          <div className="bg-error-container text-on-error-container text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setStep(1)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-all"
          >
            ← Back
          </button>
          <button
            onClick={handleReviewCourse}
            disabled={reviewing || !canvasUrl.trim() || Boolean(canvasUrlError) || needsPat}
            className="btn-primary-gradient text-on-primary font-bold px-6 py-2.5 rounded-xl text-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {reviewing ? "Checking Course…" : "Review Course →"}
          </button>
        </div>

        <div className="mt-2 p-4 bg-surface-container-low rounded-xl flex gap-3">
          <span className="text-secondary text-lg shrink-0">ℹ</span>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Curator pulls course content, modules, assignments, discussions, quizzes, and files. Student submissions and grades are not synced.
          </p>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button
            aria-label="Close confirmation"
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            onClick={() => setPreview(null)}
          />
          <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-xl shadow-2xl overflow-hidden">
            <div className="bg-surface-container-low p-8 flex justify-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-xl bg-white shadow-sm flex items-center justify-center -rotate-3 text-4xl text-primary">
                  ◇
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center border-4 border-surface-container-lowest text-on-secondary-container">
                  ⟳
                </div>
              </div>
            </div>

            <div className="p-8">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight mb-2">
                  Confirm Course Connection
                </h2>
                <p className="text-sm text-on-surface-variant font-medium">
                  Confirm this is the Canvas course you want to pull into Curator.
                </p>
              </div>

              <div className="bg-surface p-5 rounded-xl ghost-border mb-8 space-y-4">
                <div className="flex items-center justify-between border-b border-outline-variant/10 pb-3 gap-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Course Name</span>
                  <span className="text-sm font-bold text-primary text-right">{preview.course_name}</span>
                </div>
                <div className="flex items-center justify-between border-b border-outline-variant/10 pb-3 gap-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Course ID</span>
                  <span className="text-sm font-medium text-on-surface">#{preview.canvas_course_id}</span>
                </div>
                <div className="flex items-center justify-between border-b border-outline-variant/10 pb-3 gap-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Term</span>
                  <span className="text-sm font-medium text-on-surface">{preview.term_name ?? "Not provided"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Permissions</span>
                  <div className="flex gap-1">
                    <span className="bg-secondary-container/20 text-on-secondary-container text-[9px] font-bold px-1.5 py-0.5 rounded">READ</span>
                    <span className="bg-secondary-container/20 text-on-secondary-container text-[9px] font-bold px-1.5 py-0.5 rounded">SYNC</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleConfirmAndPull}
                  disabled={confirming}
                  className="btn-primary-gradient text-on-primary font-headline font-bold text-sm py-3.5 px-6 rounded-xl shadow-lg hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden>⇩</span>
                  {confirming ? "Starting Pull…" : "Confirm & Pull Content"}
                </button>
                <button
                  onClick={() => setPreview(null)}
                  disabled={confirming}
                  className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-headline font-bold text-sm py-3 px-6 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-6 text-[10px] text-center text-on-surface-variant font-medium leading-relaxed">
                By confirming, you authorize Canvas Curator to access course materials for instructional analysis.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
