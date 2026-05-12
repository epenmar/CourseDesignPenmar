import { createClient } from "@/lib/supabase/server";
import Alert from "@/components/edplus/Alert";
import Card, { CardBody } from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";
import IncomingHandoffsList from "./IncomingHandoffsList";

// Server component — pulls the auth token + the initial list of pending
// CourseCompose handoffs, then hands off to the client component for
// the View Bundle modal + Start Build action. Pending list is paginated
// via the API's limit param (cap at 100; an inbox over that size is
// pathological for an instructional designer and we'll add cursor
// pagination if the symptom appears).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type HandoffSummary = {
  id: string;
  received_at: string;
  status: string;
  course_code: string | null;
  course_title: string | null;
  generated_by: string | null;
  generated_role: string | null;
  source: string | null;
  processed_at: string | null;
  notes: string | null;
};

async function loadHandoffs(token: string | null) {
  if (!token) return { handoffs: [], error: "Not signed in." as string | null };
  try {
    const res = await fetch(`${API_URL}/api/coursecompose/handoffs?status=pending&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { handoffs: [], error: `API ${res.status}: ${body.slice(0, 200) || "(empty body)"}` };
    }
    const data = (await res.json()) as { handoffs: HandoffSummary[]; count: number };
    return { handoffs: data.handoffs ?? [], error: null as string | null };
  } catch (err) {
    return {
      handoffs: [] as HandoffSummary[],
      error: `Network: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export const dynamic = "force-dynamic";

export default async function IncomingHandoffsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const { handoffs, error } = await loadHandoffs(token);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Incoming from CourseCompose
          </h2>
          <p className="text-on-surface-variant text-sm mt-1">
            Pending handoff bundles ready to build into a Canvas course.
          </p>
        </div>
      </div>

      {!user && (
        <Alert variant="warning">
          You need to be signed in to see incoming handoffs.
        </Alert>
      )}

      {user && error && (
        <Alert variant="error">
          <strong>Could not load handoffs.</strong> {error}
        </Alert>
      )}

      {user && !error && handoffs.length === 0 && (
        <Card>
          <CardBody>
            <EmptyState
              title="No pending handoffs"
              description="When someone clicks 🚀 Hand off to CanvasCurate from the CourseCompose worksheet, the bundle will appear here. Pending handoffs that supersede each other (multiple pushes for the same course) only show the latest."
            />
          </CardBody>
        </Card>
      )}

      {user && !error && handoffs.length > 0 && (
        <IncomingHandoffsList
          handoffs={handoffs}
          apiUrl={API_URL}
          token={token ?? ""}
        />
      )}
    </div>
  );
}
