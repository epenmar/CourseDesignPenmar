import { notFound } from "next/navigation";

import DocumentDetailManager from "@/modules/documents/components/DocumentDetailManager";
import { createClient } from "@/lib/supabase/server";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id, docId } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: auth }] = await Promise.all([
    supabase.from("sessions").select("id").eq("id", id).single(),
    supabase.auth.getSession(),
  ]);

  if (!session || !auth.session) notFound();

  return <DocumentDetailManager sessionId={id} documentId={docId} />;
}
