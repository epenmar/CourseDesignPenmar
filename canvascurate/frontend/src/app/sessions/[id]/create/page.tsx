import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CourseCreationWorkspace from "@/modules/course_creation/components/CourseCreationWorkspace";

export default async function CourseCreationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, type")
    .eq("id", id)
    .single();

  if (!session || session.type !== "create") {
    notFound();
  }

  return <CourseCreationWorkspace sessionId={id} />;
}
