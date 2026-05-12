import { notFound } from "next/navigation";

import DocumentsManager from "@/modules/documents/components/DocumentsManager";
import { createClient } from "@/lib/supabase/server";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: auth }] = await Promise.all([
    supabase.from("sessions").select("id, type").eq("id", id).single(),
    supabase.auth.getSession(),
  ]);

  if (!session || !auth.session) notFound();

  return <DocumentsManager sessionId={id} sessionType={session.type} />;
}
