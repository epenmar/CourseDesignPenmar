import { notFound } from "next/navigation";

import FindReplaceManager from "@/components/ui/FindReplaceManager";
import { createClient } from "@/lib/supabase/server";

export default async function FindReplacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", id)
    .single();

  if (!session) notFound();

  return <FindReplaceManager sessionId={id} />;
}
