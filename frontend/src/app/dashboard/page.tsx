import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import Alert from "@/components/edplus/Alert";
import Badge from "@/components/edplus/Badge";
import { ButtonLink } from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

const TYPE_LABELS: Record<string, string> = {
  curate: "Curate",
  create: "Create",
  transfer: "Transfer",
  document: "Document",
};

const TYPE_VARIANTS: Record<string, "default" | "primary" | "warning"> = {
  curate: "primary",
  create: "warning",
  transfer: "default",
  document: "default",
};

type SessionCard = {
  id: string;
  name: string;
  type: string;
  status: string;
  updated_at: string;
  meta?: Record<string, unknown> | null;
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isExportedCourseCreationSession(session: { type: string; meta?: Record<string, unknown> | null }) {
  const courseCreation = session.meta?.course_creation;
  return session.type === "create"
    && typeof courseCreation === "object"
    && courseCreation !== null
    && "status" in courseCreation
    && courseCreation.status === "exported_to_canvas_clean";
}

function sessionHref(session: { id: string; type: string; meta?: Record<string, unknown> | null }) {
  if (isExportedCourseCreationSession(session)) return `/sessions/${session.id}/edit`;
  if (session.type === "create") return `/sessions/${session.id}/create`;
  if (session.type === "document") return `/sessions/${session.id}/documents`;
  return `/sessions/${session.id}/health`;
}

function SessionCards({ sessions }: { sessions: SessionCard[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={sessionHref(s)}
          className="group block"
        >
          <Card interactive className="h-full">
            <CardBody className="p-5">
              <div className="mb-4 flex items-start justify-between">
                <Badge variant={TYPE_VARIANTS[s.type] ?? "default"} className="rounded-md text-[10px] uppercase tracking-wider">
                  {TYPE_LABELS[s.type] ?? s.type}
                </Badge>
              </div>
              <h4 className="mb-1 line-clamp-2 font-headline text-base font-bold leading-tight text-on-surface">
                {s.name}
              </h4>
              <div className="mt-4 flex items-center justify-between border-t border-outline-variant pt-4 text-on-surface-variant">
                <span className="text-[11px] font-semibold">
                  {timeAgo(s.updated_at)}
                </span>
                <span className="text-lg text-primary transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>
            </CardBody>
          </Card>
        </Link>
      ))}
    </div>
  );
}

type ExpiringCredential = {
  id: string;
  canvas_base_url: string;
  expires_at: string;
  days_remaining: number;
  expired: boolean;
};

async function getExpiringCredentials(token?: string): Promise<ExpiringCredential[]> {
  if (!token) return [];

  try {
    const res = await fetch(`${API_URL}/canvas/credentials/expiring?days=2`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = await res.json() as { credentials?: ExpiringCredential[] };
    return body.credentials ?? [];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: { session: authSession } }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);

  const firstName = user?.user_metadata?.full_name?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? "there";

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, name, type, status, updated_at, meta")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(20);

  const expiringCredentials = await getExpiringCredentials(authSession?.access_token);
  const activeSessions = (sessions ?? []) as SessionCard[];
  const groupedSessions = [
    { key: "curate", title: "Curate Sessions", sessions: activeSessions.filter((session) => session.type === "curate") },
    { key: "create", title: "Create Sessions", sessions: activeSessions.filter((session) => session.type === "create") },
    { key: "document", title: "Documents", sessions: activeSessions.filter((session) => session.type === "document") },
  ].filter((group) => group.sessions.length > 0);
  const otherSessions = activeSessions.filter((session) => !["curate", "create", "document"].includes(session.type));

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Good morning, {firstName}
          </h2>
          <p className="text-on-surface-variant text-sm mt-1">
            Your active sessions and course work
          </p>
        </div>
        <ButtonLink
          href="/sessions/new"
          icon={<span aria-hidden="true">+</span>}
        >
          Start New Session
        </ButtonLink>
      </div>

      {expiringCredentials.length > 0 && (
        <Alert
          variant="warning"
          title={`Canvas access token ${expiringCredentials.some((cred) => cred.expired) ? "expired" : "expires soon"}`}
          className="items-center"
        >
          {expiringCredentials.map((cred) => (
            `${cred.canvas_base_url} ${
              cred.expired
                ? "expired"
                : `expires in ${Math.max(cred.days_remaining, 0)} day${cred.days_remaining === 1 ? "" : "s"}`
            }`
          )).join(" · ")}
          <ButtonLink
            href="/sessions/new"
            variant="secondary"
            size="sm"
            className="ml-3 shrink-0"
          >
            Refresh Token
          </ButtonLink>
        </Alert>
      )}

      {/* Sessions grid */}
      <section>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-4">
          Active Sessions
        </h3>

        {!activeSessions.length ? (
          <Card>
            <EmptyState
              icon="📚"
              title="No sessions yet"
              description="Start a new session to connect a Canvas course."
              action={(
                <ButtonLink
                  href="/sessions/new"
                >
                  Connect a Course
                </ButtonLink>
              )}
            />
          </Card>
        ) : (
          <div className="space-y-8">
            {groupedSessions.map((group) => (
              <section key={group.key}>
                <h4 className="mb-3 font-headline text-base font-bold text-on-surface">
                  {group.title}
                </h4>
                <SessionCards sessions={group.sessions} />
              </section>
            ))}
            {otherSessions.length > 0 ? (
              <section>
                <h4 className="mb-3 font-headline text-base font-bold text-on-surface">
                  Other Sessions
                </h4>
                <SessionCards sessions={otherSessions} />
              </section>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
