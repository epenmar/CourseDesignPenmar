import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import AdminDiagnosticsWorkspace from "@/modules/admin/components/AdminDiagnosticsWorkspace";

const ADMIN_ROLES = new Set(["system_admin", "super_admin"]);

export default async function AdminDiagnosticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || !ADMIN_ROLES.has(String(profile.role || ""))) {
    notFound();
  }

  return <AdminDiagnosticsWorkspace />;
}
