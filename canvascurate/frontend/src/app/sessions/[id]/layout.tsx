import { createClient } from "@/lib/supabase/server";
import SideNav from "@/components/ui/SideNav";
import AppHeader from "@/components/ui/AppHeader";
import { notFound } from "next/navigation";

export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: { user } }, { data: session, error: sessionError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("sessions")
      .select("id, name, type, source_course_id, meta")
      .eq("id", id)
      .single(),
  ]);
  const { data: profile } = user
    ? await supabase.from("user_profiles").select("role, is_active").eq("id", user.id).single()
    : { data: null };
  const isSystemAdmin = Boolean(
    profile?.is_active && ["system_admin", "super_admin"].includes(String(profile.role || "")),
  );

  if (sessionError || !session) notFound();

  let canvasBaseUrl: string | null = null;
  if (session.source_course_id) {
    const { data: course } = await supabase
      .from("courses")
      .select("canvas_base_url")
      .eq("id", session.source_course_id)
      .single();
    canvasBaseUrl = course?.canvas_base_url ?? null;
  }

  const sessionName = session.name;
  const meta = session.meta && typeof session.meta === "object" ? session.meta as Record<string, unknown> : {};
  const courseCreation = meta.course_creation && typeof meta.course_creation === "object"
    ? meta.course_creation as Record<string, unknown>
    : {};
  const effectiveSessionType = session.type === "create" && courseCreation.status === "exported_to_canvas_clean"
    ? "curate"
    : session.type;

  return (
    <div className="flex min-h-screen bg-surface">
      <SideNav canvasBaseUrl={canvasBaseUrl} sessionId={id} sessionType={effectiveSessionType} />
      <div className="ml-[var(--app-nav-width)] flex min-h-screen flex-1 flex-col transition-[margin-left] duration-200">
        <AppHeader
          email={user?.email ?? null}
          avatarUrl={user?.user_metadata?.avatar_url ?? null}
          sessionName={sessionName}
          isSystemAdmin={isSystemAdmin}
        />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
