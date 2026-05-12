import { createClient } from "@/lib/supabase/server";
import SyncCourseButton from "@/components/ui/SyncCourseButton";
import InventoryTable from "@/components/ui/InventoryTable";
import Link from "next/link";
import { notFound } from "next/navigation";

const CONTENT_TYPES = [
  { value: "all", label: "All" },
  { value: "page", label: "Pages" },
  { value: "assignment", label: "Assignments" },
  { value: "discussion", label: "Discussions" },
  { value: "quiz", label: "Quizzes" },
  { value: "file", label: "Files" },
  { value: "module", label: "Modules" },
] as const;

type InventorySearchParams = {
  type?: string;
};

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InventorySearchParams>;
}) {
  const { id } = await params;
  const { type = "all" } = await searchParams;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!session) notFound();

  const selectedType = CONTENT_TYPES.some((item) => item.value === type) ? type : "all";

  return (
    <div className="max-w-7xl mx-auto space-y-7">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <nav className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
            <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
            <span>›</span>
            <Link href={`/sessions/${id}/health`} className="hover:text-primary transition-colors">Course Health</Link>
            <span>›</span>
            <span className="text-on-surface font-semibold">Inventory</span>
          </nav>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Content Inventory
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Search, sort, preview, and decide what content should stay in the course.
          </p>
        </div>
        <SyncCourseButton sessionId={id} variant="secondary" />
      </div>

      <InventoryTable sessionId={id} initialType={selectedType} />
    </div>
  );
}
