import { createClient } from "@/lib/supabase/server";
import SyncCourseButton from "@/components/ui/SyncCourseButton";
import HealthRunButton from "@/components/ui/HealthRunButton";
import { Alert, Badge, ButtonLink, Card, CardHeader } from "@/components/edplus";
import Link from "next/link";
import { notFound } from "next/navigation";

const CONTENT_METRICS = [
  { type: "page", label: "Pages", path: "edit" },
  { type: "assignment", label: "Assignments", path: "edit" },
  { type: "quiz", label: "Quizzes", path: "edit" },
  { type: "discussion", label: "Discussions", path: "edit" },
  { type: "file", label: "Files", path: "documents" },
  { type: "module", label: "Modules", path: "inventory" },
] as const;

type ContentType = typeof CONTENT_METRICS[number]["type"];

type ContentRow = {
  id: string;
  title: string | null;
  content_type: ContentType;
  published: boolean | null;
  is_orphaned: boolean;
  duplicate_group_key: string | null;
  canvas_url: string | null;
};

type HealthSummary = {
  total_findings?: number;
  by_severity?: Record<string, number>;
  by_code?: Record<string, number>;
};

type HealthRunRow = {
  id: string;
  status: string;
  items_scanned: number;
  duration_ms: number | null;
  summary: HealthSummary | null;
  created_at: string;
  finished_at: string | null;
};

type FindingRow = {
  id: string;
  content_item_id: string | null;
  finding_type: string;
  finding_code: string | null;
  severity: "critical" | "warning" | "info";
  description: string | null;
  context: Record<string, unknown>;
  is_resolved?: boolean;
  created_at?: string;
};

type HealthSearchParams = {
  issue?: string;
  severity?: string;
  page?: string;
};

type WorkOnCard = {
  href: string;
  label: string;
  value: string;
  status: string;
  tone: "primary" | "secondary" | "neutral";
  isPlaceholder?: boolean;
};

function countRows(rows: ContentRow[], type: ContentType) {
  const typed = rows.filter((row) => row.content_type === type);
  return {
    total: typed.length,
    inModule: typed.filter((row) => !row.is_orphaned).length,
    orphaned: typed.filter((row) => row.is_orphaned).length,
    unpublished: typed.filter((row) => row.published === false).length,
    duplicates: typed.filter((row) => row.duplicate_group_key).length,
  };
}

function formatDate(value?: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function codeLabel(value: string | null) {
  if (!value) return "Issue";
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function severityClass(severity: FindingRow["severity"]) {
  if (severity === "critical") return "bg-error-container text-error";
  if (severity === "warning") return "bg-secondary-container/25 text-secondary";
  return "bg-surface-container text-on-surface-variant";
}

function severityLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sumCodes(summary: HealthSummary, codes: string[]) {
  return codes.reduce((total, code) => total + (summary.by_code?.[code] ?? 0), 0);
}

const ISSUE_FILTERS = [
  {
    value: "all",
    label: "All Findings",
    description: "Everything from the latest health scan",
  },
  {
    value: "wcag",
    label: "WCAG",
    description: "Accessibility findings",
    findingType: "wcag",
    codes: [
      "missing_image_alt",
      "generic_image_alt",
      "filename_image_alt",
      "image_alt_too_long",
      "empty_link_text",
      "generic_link_text",
      "empty_heading",
      "skipped_heading_level",
      "table_missing_header",
    ],
  },
  {
    value: "images",
    label: "Images",
    description: "Missing, generic, filename, or long image alt text",
    codes: ["missing_image_alt", "generic_image_alt", "filename_image_alt", "image_alt_too_long"],
  },
  {
    value: "links",
    label: "Links",
    description: "Empty or vague link text",
    codes: ["empty_link_text", "generic_link_text"],
  },
  {
    value: "structure",
    label: "Structure",
    description: "Heading and table issues",
    codes: ["empty_heading", "skipped_heading_level", "table_missing_header"],
  },
  {
    value: "inventory",
    label: "Inventory",
    description: "Orphans, duplicates, unpublished items",
    findingType: "inventory",
    codes: ["orphaned_content", "duplicate_content", "unpublished_content"],
  },
  {
    value: "duplicates",
    label: "Duplicates",
    description: "Duplicate title and body matches",
    codes: ["duplicate_content"],
  },
] as const;

const SEVERITY_FILTERS = ["all", "critical", "warning", "info"] as const;
const IMAGE_ALT_ISSUE_CODES = new Set([
  "missing_image_alt",
  "generic_image_alt",
  "filename_image_alt",
  "image_alt_too_long",
]);

function issueCount(summary: HealthSummary, issue: (typeof ISSUE_FILTERS)[number]) {
  if (issue.value === "all") return summary.total_findings ?? 0;
  if (issue.codes) return sumCodes(summary, [...issue.codes]);
  return 0;
}

function issueHref(sessionId: string, issue: string, severity: string) {
  const params = new URLSearchParams();
  if (issue !== "all") params.set("issue", issue);
  if (severity !== "all") params.set("severity", severity);
  const suffix = params.toString();
  return `/sessions/${sessionId}/health${suffix ? `?${suffix}` : ""}`;
}

function issuePageHref(sessionId: string, issue: string, severity: string, page: number) {
  const params = new URLSearchParams();
  if (issue !== "all") params.set("issue", issue);
  if (severity !== "all") params.set("severity", severity);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `/sessions/${sessionId}/health${suffix ? `?${suffix}` : ""}`;
}

function contextSummary(context: Record<string, unknown>) {
  const details = [
    typeof context.src === "string" && context.src ? `Image: ${context.src}` : null,
    typeof context.alt === "string" && context.alt ? `Alt: ${context.alt}` : null,
    typeof context.display_name === "string" && context.display_name ? `File: ${context.display_name}` : null,
    typeof context.href === "string" && context.href ? `Link: ${context.href}` : null,
    typeof context.text === "string" && context.text ? `Text: ${context.text}` : null,
    typeof context.tag === "string" && context.tag ? `Tag: ${context.tag.toUpperCase()}` : null,
    typeof context.from === "number" && typeof context.to === "number" ? `H${context.from} to H${context.to}` : null,
    typeof context.duplicate_count === "number" ? `${context.duplicate_count} matching items` : null,
  ].filter(Boolean);
  return details.slice(0, 2).join(" · ");
}

function contentActionHref(sessionId: string, item?: ContentRow | null, finding?: FindingRow | null) {
  if (IMAGE_ALT_ISSUE_CODES.has(finding?.finding_code || "")) {
    return `/sessions/${sessionId}/images`;
  }
  if (!item) return `/sessions/${sessionId}/inventory`;
  if (item.content_type === "file" || item.content_type === "module") {
    return `/sessions/${sessionId}/inventory?type=${item.content_type}`;
  }
  return `/sessions/${sessionId}/edit`;
}

export default async function HealthPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<HealthSearchParams>;
}) {
  const { id } = await params;
  const {
    issue = "all",
    severity = "all",
    page: pageParam = "1",
  } = await searchParams;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, name, source_course_id")
    .eq("id", id)
    .single();

  if (!session) notFound();

  const [{ data: contentRows }, { data: latestRun }, { count: standaloneDocumentCount }, { data: latestHealthRun }] = await Promise.all([
    supabase
      .from("course_content_items")
      .select("id, title, content_type, published, is_orphaned, duplicate_group_key, canvas_url")
      .eq("session_id", id),
    supabase
      .from("course_sync_runs")
      .select("id, status, fetched_count, changed_count, error_message, created_at, finished_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("session_id", id),
    supabase
      .from("health_runs")
      .select("id, status, items_scanned, duration_ms, summary, created_at, finished_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (contentRows ?? []) as ContentRow[];
  const stats = Object.fromEntries(
    CONTENT_METRICS.map((metric) => [metric.type, countRows(rows, metric.type)])
  ) as Record<ContentType, ReturnType<typeof countRows>>;
  const documentInventoryCount = stats.file.total + (standaloneDocumentCount ?? 0);

  const totalItems = rows.length;
  const hasSyncedContent = totalItems > 0;
  const totalOrphaned = rows.filter((row) => row.is_orphaned && row.content_type !== "module").length;
  const orphanedDuplicateItemCount = rows.filter(
    (row) => (row.is_orphaned && row.content_type !== "module") || row.duplicate_group_key
  ).length;
  const totalUnpublished = rows.filter((row) => row.published === false).length;
  const healthRun = latestHealthRun as HealthRunRow | null;
  const healthSummary = healthRun?.summary ?? {};
  const totalFindings = healthSummary.total_findings ?? 0;
  const wcagFindingCount = sumCodes(healthSummary, [
    "missing_image_alt",
    "generic_image_alt",
    "filename_image_alt",
    "image_alt_too_long",
    "empty_link_text",
    "generic_link_text",
    "empty_heading",
    "skipped_heading_level",
    "table_missing_header",
  ]);
  const imageAltFindingCount = sumCodes(healthSummary, [
    "missing_image_alt",
    "generic_image_alt",
    "filename_image_alt",
    "image_alt_too_long",
  ]);
  const linkTextFindingCount = sumCodes(healthSummary, ["empty_link_text", "generic_link_text"]);
  const criticalCount = healthSummary.by_severity?.critical ?? 0;
  const warningCount = healthSummary.by_severity?.warning ?? 0;
  const selectedIssue = ISSUE_FILTERS.find((item) => item.value === issue) ?? ISSUE_FILTERS[0];
  const selectedSeverity = SEVERITY_FILTERS.includes(severity as (typeof SEVERITY_FILTERS)[number]) ? severity : "all";
  const currentPage = Math.max(Number.parseInt(pageParam, 10) || 1, 1);
  const pageSize = 25;

  let filteredFindings: FindingRow[] = [];
  let filteredFindingCount = 0;
  if (healthRun?.id) {
    let findingsQuery = supabase
      .from("health_findings")
      .select("id, content_item_id, finding_type, finding_code, severity, description, context, is_resolved, created_at", { count: "exact" })
      .eq("health_run_id", healthRun.id)
      .order("created_at", { ascending: false });

    if (selectedIssue.value !== "all") {
      if (selectedIssue.codes) {
        findingsQuery = findingsQuery.in("finding_code", [...selectedIssue.codes]);
      } else if ("findingType" in selectedIssue && selectedIssue.findingType) {
        findingsQuery = findingsQuery.eq("finding_type", selectedIssue.findingType);
      }
    }

    if (selectedSeverity !== "all") {
      findingsQuery = findingsQuery.eq("severity", selectedSeverity);
    }

    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: findingRows, count } = await findingsQuery.range(from, to);
    filteredFindings = (findingRows ?? []) as FindingRow[];
    filteredFindingCount = count ?? 0;
  }
  const totalFindingPages = Math.max(Math.ceil(filteredFindingCount / pageSize), 1);

  const contentById = Object.fromEntries(rows.map((row) => [row.id, row]));

  const workOnCards: WorkOnCard[] = [
    {
      href: `/sessions/${id}/documents`,
      label: "Documents",
      value: String(documentInventoryCount),
      status: documentInventoryCount
        ? "Review PDF remediation, TagFlow, replacements, and cleanup"
        : "Open document inventory to upload files or review synced course documents",
      tone: "primary",
    },
    {
      href: issueHref(id, "images", "all"),
      label: "Image Alt Text",
      value: healthRun ? String(imageAltFindingCount) : "0",
      status: healthRun
        ? `${imageAltFindingCount} image alt text finding${imageAltFindingCount === 1 ? "" : "s"}`
        : "Run a health scan to count image alt text issues",
      tone: "secondary",
      isPlaceholder: !healthRun,
    },
    {
      href: issueHref(id, "links", "all"),
      label: "Link Text",
      value: healthRun ? String(linkTextFindingCount) : "0",
      status: healthRun
        ? `${linkTextFindingCount} vague or empty link finding${linkTextFindingCount === 1 ? "" : "s"}`
        : "Run a health scan to count link text issues",
      tone: "neutral",
      isPlaceholder: !healthRun,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <nav className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
            <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
            <span>›</span>
            <span className="text-on-surface font-semibold">Course Health</span>
          </nav>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Course Health
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Last pull {formatDate(latestRun?.finished_at ?? latestRun?.created_at)}
            {latestRun && ` · ${latestRun.fetched_count ?? 0} fetched · ${latestRun.changed_count ?? 0} changed`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap lg:justify-end">
          <ButtonLink
            href={`/sessions/${id}/inventory`}
            variant="ghost"
          >
            View Full Inventory
          </ButtonLink>
          <ButtonLink
            href={`/sessions/${id}/edit`}
            variant="ghost"
            className="text-on-surface"
          >
            Edit Content
          </ButtonLink>
          <HealthRunButton sessionId={id} disabled={!hasSyncedContent} />
          <SyncCourseButton sessionId={id} showStatusText={false} />
        </div>
      </div>

      {!hasSyncedContent && (
        <Alert variant="warning" title="Course not synced yet" className="border-l-4 border-l-secondary-container">
          Start a Canvas sync to pull pages, assignments, discussions, quizzes, files, and modules into Curator.
        </Alert>
      )}

      {latestRun?.status === "failed" && (
        <Alert variant="error">
          Last Canvas pull failed: {latestRun.error_message ?? "Unknown error"}
        </Alert>
      )}

      {healthRun?.status === "failed" && (
        <Alert variant="error">
          Last health scan failed. Re-run the scan after confirming the course has synced content.
        </Alert>
      )}

      {healthRun && (
        <Card as="section" className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Latest Health Scan</p>
            <p className="text-sm text-on-surface mt-1">
              {healthRun.status} · {healthRun.items_scanned} items scanned · {formatDate(healthRun.finished_at ?? healthRun.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant">
            <span><strong className="text-error">{criticalCount}</strong> critical</span>
            <span><strong className="text-secondary">{warningCount}</strong> warnings</span>
            <span><strong className="text-on-surface">{totalFindings}</strong> total findings</span>
          </div>
        </Card>
      )}

      <Card as="section" className="rounded-xl bg-surface-container-low p-5">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-on-surface-variant">
          {CONTENT_METRICS.map((metric) => (
            <Link
              key={metric.type}
              href={`/sessions/${id}/${metric.path}`}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <span className="font-bold text-on-surface">{stats[metric.type].total}</span>
              <span>{metric.label}</span>
            </Link>
          ))}
        </div>
      </Card>

      {(totalUnpublished > 0 || totalOrphaned > 0) && (
        <section className="space-y-2">
          {totalUnpublished > 0 && (
            <Card className="rounded-xl p-3 text-xs text-on-surface-variant">
              <strong className="text-on-surface">{totalUnpublished} unpublished item{totalUnpublished === 1 ? "" : "s"}</strong>
              {" "}pulled from Canvas. These may be hidden from students.
            </Card>
          )}
          {totalOrphaned > 0 && (
            <Card className="rounded-xl bg-secondary-container/15 p-3 text-xs text-on-surface-variant">
              <strong className="text-secondary">{totalOrphaned} item{totalOrphaned === 1 ? "" : "s"} not in modules</strong>
              {" "}need review before cleanup or transfer.
            </Card>
          )}
        </section>
      )}

      <section>
        <h2 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-3">Work On</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {workOnCards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="group block"
            >
              <Card interactive className="h-full rounded-xl p-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${
                    card.tone === "primary"
                      ? "bg-primary/10 text-primary"
                      : card.tone === "secondary"
                        ? "bg-secondary-container/25 text-secondary"
                        : "bg-surface-container text-on-surface-variant"
                  }`}>
                    {card.label[0]}
                  </div>
                  <span className={`text-2xl font-headline font-extrabold ${card.isPlaceholder ? "text-on-surface-variant text-base" : "text-on-surface"}`}>
                    {card.value}
                  </span>
                </div>
                <h3 className="font-bold text-on-surface">{card.label}</h3>
                <p className="text-xs text-on-surface-variant mt-1">{card.status}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-3">View</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href={issueHref(id, "wcag", "all")}
            className="block"
          >
            <Card interactive className="h-full rounded-xl border-l-4 border-l-primary p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-on-surface">Simple WCAG Issues</h3>
                  <p className="text-xs text-on-surface-variant mt-1">Headings, tables, empty links</p>
                </div>
                <span className="text-3xl font-headline font-black text-primary/80">
                  {healthRun ? wcagFindingCount : "—"}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-4">
                Missing, filename, or generic alt text; vague links; heading structure; and table headers.
              </p>
            </Card>
          </Link>

          <Link
            href={issueHref(id, "inventory", "all")}
            className="block"
          >
            <Card interactive className="h-full rounded-xl border-l-4 border-l-secondary-container p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-on-surface">Orphaned & Duplicate</h3>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {stats.page.orphaned} pages, {stats.assignment.orphaned} assignments, {stats.discussion.orphaned} discussions, {stats.quiz.orphaned} quizzes
                  </p>
                </div>
                <span className="text-3xl font-headline font-black text-secondary">
                  {orphanedDuplicateItemCount}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-4">
                Unique items that are orphaned, duplicated, or both. Preview and decide what to keep in the full inventory.
              </p>
            </Card>
          </Link>
        </div>
      </section>

      <Card as="section" className="rounded-xl overflow-hidden">
        <CardHeader className="bg-surface-container-low flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="font-headline font-bold text-on-surface">Issue Drill-Down</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {healthRun ? "Filter the latest health scan by issue type and severity" : "Run a health scan to populate WCAG and inventory findings"}
            </p>
          </div>
          {healthRun && (
            <span className="text-xs font-bold text-on-surface-variant">
              {filteredFindingCount} shown · {totalFindings} total
            </span>
          )}
        </CardHeader>

        {healthRun && (
          <div className="px-5 py-4 border-b border-outline-variant/20 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {ISSUE_FILTERS.map((filter) => {
                const count = issueCount(healthSummary, filter);
                const selected = filter.value === selectedIssue.value;
                return (
                  <Link
                    key={filter.value}
                    href={issueHref(id, filter.value, selectedSeverity)}
                    className={`rounded-xl p-4 transition-all ${
                      selected
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-low hover:bg-surface-container"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{filter.label}</p>
                        <p className={`text-[11px] mt-1 leading-snug ${selected ? "text-on-primary/80" : "text-on-surface-variant"}`}>
                          {filter.description}
                        </p>
                      </div>
                      <span className="text-right">
                        <span className={`block font-headline text-xl font-black ${selected ? "text-on-primary" : "text-primary"}`}>
                          {count}
                        </span>
                        <span className={`block text-[9px] font-bold uppercase ${selected ? "text-on-primary/75" : "text-on-surface-variant"}`}>
                          findings
                        </span>
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {SEVERITY_FILTERS.map((filter) => {
                const selected = filter === selectedSeverity;
                return (
                  <Link
                    key={filter}
                    href={issueHref(id, selectedIssue.value, filter)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      selected
                        ? "bg-secondary-container text-on-secondary-container"
                        : "bg-surface-container-low text-on-surface-variant hover:text-primary"
                    }`}
                  >
                    {filter === "all" ? "All Severities" : severityLabel(filter)}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {filteredFindings.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  <th className="px-5 py-3">Severity</th>
                  <th className="px-5 py-3">Issue</th>
                  <th className="px-5 py-3">Content</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {filteredFindings.map((finding) => {
                  const item = finding.content_item_id ? contentById[finding.content_item_id] : null;
                  const context = contextSummary(finding.context ?? {});
                  return (
                    <tr key={finding.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-5 py-3">
                        <Badge className={`rounded-md px-2.5 py-1 text-[11px] ${severityClass(finding.severity)}`}>
                          {finding.severity}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 font-semibold text-on-surface">{codeLabel(finding.finding_code)}</td>
                      <td className="px-5 py-3">
                        <p className="text-on-surface-variant">{item?.title ?? "Course item"}</p>
                        {item && (
                          <p className="text-[11px] text-on-surface-variant/70 mt-0.5">
                            {codeLabel(item.content_type)}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-on-surface-variant">
                        <p>{finding.description ?? "No description provided"}</p>
                        {context && <p className="text-[11px] text-on-surface-variant/75 mt-1">{context}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <ButtonLink
                            href={contentActionHref(id, item, finding)}
                            variant="ghost"
                            size="sm"
                            className="h-8 border-outline-variant px-3 py-1.5 text-xs"
                          >
                            Work item
                          </ButtonLink>
                          {item?.canvas_url && (
                            <a
                              href={item.canvas_url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg bg-surface-container-low px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                            >
                              Canvas
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalFindingPages > 1 && (
              <div className="flex items-center justify-between border-t border-outline-variant/20 px-5 py-4 text-xs text-on-surface-variant">
                <span>
                  Page {Math.min(currentPage, totalFindingPages)} of {totalFindingPages}
                </span>
                <div className="flex items-center gap-2">
                  <ButtonLink
                    href={issuePageHref(id, selectedIssue.value, selectedSeverity, Math.max(currentPage - 1, 1))}
                    variant="ghost"
                    size="sm"
                    disabled={currentPage <= 1}
                  >
                    Previous
                  </ButtonLink>
                  <ButtonLink
                    href={issuePageHref(id, selectedIssue.value, selectedSeverity, Math.min(currentPage + 1, totalFindingPages))}
                    variant="ghost"
                    size="sm"
                    disabled={currentPage >= totalFindingPages}
                  >
                    Next
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-on-surface-variant text-center">
            {healthRun ? "No findings match the selected filters." : "No health scan has been run yet."}
          </div>
        )}
      </Card>

      <Card as="section" className="rounded-xl overflow-hidden">
        <CardHeader className="bg-surface-container-low flex items-center justify-between">
          <div>
            <h2 className="font-headline font-bold text-on-surface">Inventory Summary</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Counts by content type and Canvas course placement</p>
          </div>
          <Link href={`/sessions/${id}/inventory`} className="text-xs font-bold text-primary hover:underline">
            Open table
          </Link>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                <th className="px-5 py-3">Content</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">In Modules</th>
                <th className="px-5 py-3 text-right">Not In Module</th>
                <th className="px-5 py-3 text-right">Unpublished</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {CONTENT_METRICS.map((metric) => (
                <tr key={metric.type} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-5 py-3 font-semibold text-on-surface">{metric.label}</td>
                  <td className="px-5 py-3 text-right text-on-surface">{stats[metric.type].total}</td>
                  <td className="px-5 py-3 text-right text-on-surface-variant">{stats[metric.type].inModule}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={stats[metric.type].orphaned > 0 ? "font-bold text-secondary" : "text-on-surface-variant"}>
                      {stats[metric.type].orphaned}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-on-surface-variant">{stats[metric.type].unpublished}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
