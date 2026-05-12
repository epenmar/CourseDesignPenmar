import { createClient } from "@/lib/supabase/server";
import SideNav from "@/components/ui/SideNav";
import AppHeader from "@/components/ui/AppHeader";

export default async function NewSessionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("user_profiles").select("role, is_active").eq("id", user.id).single()
    : { data: null };
  const isSystemAdmin = Boolean(
    profile?.is_active && ["system_admin", "super_admin"].includes(String(profile.role || "")),
  );

  return (
    <div className="flex min-h-screen bg-surface">
      <SideNav sessionId={undefined} />
      <div className="ml-[var(--app-nav-width)] flex min-h-screen flex-1 flex-col transition-[margin-left] duration-200">
        <AppHeader
          email={user?.email ?? null}
          avatarUrl={user?.user_metadata?.avatar_url ?? null}
          isSystemAdmin={isSystemAdmin}
        />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
