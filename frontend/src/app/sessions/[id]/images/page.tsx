import { notFound } from "next/navigation";

import ImagesManager from "@/components/ui/ImagesManager";
import { createClient } from "@/lib/supabase/server";

export default async function ImagesPage({
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

  return <ImagesManager sessionId={id} />;
}
