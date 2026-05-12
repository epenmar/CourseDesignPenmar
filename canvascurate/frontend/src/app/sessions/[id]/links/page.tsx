import { notFound } from "next/navigation";

import LinksManager from "@/components/ui/LinksManager";
import { createClient } from "@/lib/supabase/server";

export default async function LinksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: auth }] = await Promise.all([
    supabase.from("sessions").select("id").eq("id", id).single(),
    supabase.auth.getSession(),
  ]);

  if (!session || !auth.session) notFound();

  return <LinksManager sessionId={id} />;
}
