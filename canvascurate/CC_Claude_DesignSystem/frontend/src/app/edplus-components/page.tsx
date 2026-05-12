"use client";

import { useState } from "react";
import {
  FileText, ImageIcon, Link2, Search, Trash2, Eye,
  Download, FolderPlus, Mail, Lock, RotateCcw,
} from "lucide-react";

// EdPlus components
import Button from "@/components/edplus/Button";
import Input from "@/components/edplus/Input";
import Card, { CardBody, CardFooter, CardHeader } from "@/components/edplus/Card";
import Modal, { ModalBody, ModalFooter } from "@/components/edplus/Modal";
import Badge from "@/components/edplus/Badge";
import Alert from "@/components/edplus/Alert";
import Divider from "@/components/edplus/Divider";
import Tabs, { type TabItem } from "@/components/edplus/Tabs";
import Pagination from "@/components/edplus/Pagination";
import SearchInput from "@/components/edplus/SearchInput";
import FilterBar from "@/components/edplus/FilterBar";
import EmptyState from "@/components/edplus/EmptyState";
import StatusBadge from "@/components/edplus/StatusBadge";
import { Skeleton, TableSkeleton, CardSkeleton } from "@/components/edplus/Skeleton";
import ConfirmDialog from "@/components/edplus/ConfirmDialog";
import BulkActionBar from "@/components/edplus/BulkActionBar";
import DataTable, { type DataTableColumn, type SortState } from "@/components/edplus/DataTable";

// ─── Demo Data ────────────────────────────────────────────────────────────────

type ContentItem = {
  id: string;
  title: string;
  content_type: string;
  status: string;
  module_name: string;
  last_edited: string;
  decision_action: string | null;
};

const DEMO_DATA: ContentItem[] = [
  { id: "1", title: "Week 1: Introduction to Machine Learning", content_type: "page", status: "published", module_name: "Module 1", last_edited: "2026-04-01", decision_action: "keep" },
  { id: "2", title: "Quiz: Supervised vs. Unsupervised", content_type: "quiz", status: "published", module_name: "Module 1", last_edited: "2026-04-03", decision_action: null },
  { id: "3", title: "Assignment 1: Dataset Exploration", content_type: "assignment", status: "draft", module_name: "Module 2", last_edited: "2026-04-05", decision_action: "defer" },
  { id: "4", title: "Discussion: Real-world ML Applications", content_type: "discussion", status: "published", module_name: "Module 2", last_edited: "2026-04-07", decision_action: "keep" },
  { id: "5", title: "Week 2: Neural Networks Fundamentals", content_type: "page", status: "unpublished", module_name: "Module 3", last_edited: "2026-04-10", decision_action: "delete" },
  { id: "6", title: "Lab 2: Building a Simple Neural Net", content_type: "assignment", status: "published", module_name: "Module 3", last_edited: "2026-04-12", decision_action: null },
];

const COLUMNS: DataTableColumn<ContentItem>[] = [
  {
    key: "title",
    label: "Title",
    sortable: true,
    widthPct: 38,
    render: (row) => (
      <span className="font-medium text-on-surface line-clamp-1">{row.title}</span>
    ),
  },
  {
    key: "content_type",
    label: "Type",
    sortable: true,
    widthPct: 14,
    render: (row) => (
      <Badge>{row.content_type}</Badge>
    ),
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    widthPct: 16,
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: "module_name",
    label: "Module",
    widthPct: 18,
    hideOnMobile: true,
    render: (row) => (
      <span className="text-on-surface-variant text-xs">{row.module_name}</span>
    ),
  },
  {
    key: "decision_action",
    label: "Decision",
    widthPct: 14,
    render: (row) => row.decision_action
      ? <StatusBadge status={row.decision_action} />
      : <span className="text-on-surface-variant/40 text-xs">—</span>,
  },
];

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function Section({ id, eyebrow, title, description, children }: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant mb-1">{eyebrow}</p>
        <h2 className="font-headline text-2xl font-bold text-on-surface">{title}</h2>
        {description && <p className="mt-1 text-sm text-on-surface-variant">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-start gap-3 ${className}`}>{children}</div>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EdPlusComponentsPage() {
  // State for interactive demos
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [sortValue, setSortValue] = useState("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortState, setSortState] = useState<SortState>({ key: "title", direction: "asc" });
  const [tableLoading, setTableLoading] = useState(false);
  const [tableEmpty, setTableEmpty] = useState(false);
  const [dismissedAlert, setDismissedAlert] = useState(false);

  const TABS: TabItem[] = [
    { value: "all", label: "All", count: 245 },
    { value: "pages", label: "Pages", count: 120 },
    { value: "assignments", label: "Assignments", count: 58 },
    { value: "quizzes", label: "Quizzes", count: 32 },
    { value: "files", label: "Files", count: 35, disabled: true },
  ];

  function fakeConfirm() {
    setConfirmLoading(true);
    setTimeout(() => {
      setConfirmLoading(false);
      setConfirmOpen(false);
    }, 1500);
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="min-h-screen bg-surface">
      {/* Nav */}
      <div className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-outline-variant px-8 py-3 flex items-center justify-between">
        <h1 className="font-headline text-lg font-bold text-on-surface">EdPlus Component Library</h1>
        <nav className="hidden md:flex items-center gap-4 text-xs font-medium text-on-surface-variant">
          {["Primitives", "Feedback", "Navigation", "Data"].map((s) => (
            <a key={s} href={`#${s.toLowerCase()}`} className="hover:text-primary transition-colors">{s}</a>
          ))}
        </nav>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-12 space-y-16">

        {/* ── Primitives ── */}
        <div id="primitives" className="space-y-12">
          <Section id="buttons" eyebrow="Primitives" title="Buttons" description="4 variants × 3 sizes + loading state.">
            <Card elevated>
              <CardBody className="space-y-6">
                {(["primary", "secondary", "ghost", "destructive"] as const).map((v) => (
                  <div key={v}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-3">{v}</p>
                    <Row>
                      <Button variant={v} size="sm">Small</Button>
                      <Button variant={v} size="md">Medium</Button>
                      <Button variant={v} size="lg">Large</Button>
                      {v === "primary" && <Button variant={v} loading>Loading</Button>}
                      {v === "primary" && <Button variant={v} icon={<FolderPlus size={15} />}>With Icon</Button>}
                    </Row>
                  </div>
                ))}
              </CardBody>
            </Card>
          </Section>

          <Section id="inputs" eyebrow="Primitives" title="Inputs" description="Labels, hints, error states, icons, full-width.">
            <Card elevated>
              <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Input label="Email" type="email" placeholder="user@asu.edu" icon={<Mail size={16} />} hint="Use your ASU email." />
                <Input label="Password" type="password" placeholder="••••••••" icon={<Lock size={16} />} />
                <Input label="Username" placeholder="jsmith" error="Username already taken." />
                <Input label="Full Width Input" placeholder="Spans the column" fullWidth />
              </CardBody>
            </Card>
          </Section>

          <Section id="badges" eyebrow="Primitives" title="Badges & StatusBadges">
            <Card elevated>
              <CardBody className="space-y-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-on-surface-variant mb-3 font-semibold">Badge (generic)</p>
                  <Row>
                    {(["default", "primary", "success", "warning", "error"] as const).map((v) => (
                      <Badge key={v} variant={v}>{v}</Badge>
                    ))}
                  </Row>
                </div>
                <Divider />
                <div>
                  <p className="text-xs uppercase tracking-widest text-on-surface-variant mb-3 font-semibold">StatusBadge (auto-maps status strings)</p>
                  <Row className="flex-wrap">
                    {["keep", "delete", "defer", "published", "unpublished", "draft", "needs_review", "passed_initial_check", "validated", "rejected", "archived", "linked", "succeeded"].map((s) => (
                      <StatusBadge key={s} status={s} />
                    ))}
                  </Row>
                </div>
              </CardBody>
            </Card>
          </Section>

          <Section id="dividers" eyebrow="Primitives" title="Dividers">
            <Card elevated>
              <CardBody className="space-y-5">
                <p className="text-sm text-on-surface-variant">Horizontal (default)</p>
                <Divider />
                <p className="text-sm text-on-surface-variant">With label</p>
                <Divider>OR</Divider>
                <p className="text-sm text-on-surface-variant">Vertical</p>
                <div className="flex items-center gap-4 h-8">
                  <span className="text-sm text-on-surface-variant">Left</span>
                  <Divider orientation="vertical" />
                  <span className="text-sm text-on-surface-variant">Right</span>
                </div>
              </CardBody>
            </Card>
          </Section>
        </div>

        {/* ── Feedback ── */}
        <div id="feedback" className="space-y-12">
          <Section id="alerts" eyebrow="Feedback" title="Alerts">
            <div className="space-y-3">
              {!dismissedAlert && (
                <Alert variant="info" title="Informational" onClose={() => setDismissedAlert(true)}>
                  Canvas sync is scheduled for tonight at 11 PM. No action required.
                </Alert>
              )}
              <Alert variant="success" title="Sync complete">
                3 modules and 47 items were successfully synced to Canvas.
              </Alert>
              <Alert variant="warning" title="Token expiring soon">
                Your Canvas PAT expires in 3 days. Update it in the header.
              </Alert>
              <Alert variant="error" title="Sync failed">
                Could not reach Canvas API. Check your token or retry.
              </Alert>
            </div>
          </Section>

          <Section id="empty" eyebrow="Feedback" title="Empty States">
            <div className="grid sm:grid-cols-2 gap-4">
              <Card elevated>
                <EmptyState
                  icon={<Search size={24} />}
                  title="No results found"
                  description="Try adjusting your search or filter to find what you're looking for."
                  action={<Button variant="ghost" size="sm" onClick={() => {}}>Clear filters</Button>}
                />
              </Card>
              <Card elevated>
                <EmptyState
                  icon={<FileText size={24} />}
                  title="No documents yet"
                  description="Upload or sync a course to see files here."
                  action={<Button variant="primary" size="sm">Sync course</Button>}
                />
              </Card>
            </div>
          </Section>

          <Section id="skeletons" eyebrow="Feedback" title="Skeletons" description="Loading placeholders — shimmer animation.">
            <div className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <CardSkeleton lines={3} />
                <CardSkeleton lines={4} showAvatar />
                <CardSkeleton lines={2} />
              </div>
              <Card elevated>
                <TableSkeleton rows={5} columns={5} showCheckbox />
              </Card>
            </div>
          </Section>

          <Section id="cards" eyebrow="Feedback" title="Cards">
            <div className="grid sm:grid-cols-2 gap-4">
              <Card elevated>
                <CardHeader><h3 className="font-semibold text-on-surface">Elevated Card</h3></CardHeader>
                <CardBody><p className="text-sm text-on-surface-variant">With header, body, and footer slots.</p></CardBody>
                <CardFooter>
                  <Button variant="ghost" size="sm">Cancel</Button>
                  <Button variant="primary" size="sm">Save</Button>
                </CardFooter>
              </Card>
              <Card elevated interactive>
                <CardBody className="p-8 text-center">
                  <div className="text-3xl mb-3">📚</div>
                  <p className="font-semibold text-on-surface">Interactive Card</p>
                  <p className="text-xs text-on-surface-variant mt-1">Hover for lift effect</p>
                </CardBody>
              </Card>
            </div>
          </Section>

          <Section id="modals" eyebrow="Feedback" title="Modal & ConfirmDialog">
            <Row>
              <Button variant="primary" onClick={() => setModalOpen(true)}>Open Modal</Button>
              <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Open Confirm Dialog</Button>
            </Row>

            <Modal open={modalOpen} onOpenChange={setModalOpen} title="Create Module" subtitle="Canvas Course">
              <ModalBody>
                <Input label="Module Name" placeholder="e.g. Week 1: Introduction" fullWidth />
                <p className="text-sm text-on-surface-variant">The module will be staged locally before syncing to Canvas.</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="ghost" size="md" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button variant="primary" size="md">Create Module</Button>
              </ModalFooter>
            </Modal>

            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Delete 3 items?"
              description="This will permanently remove the selected content items from this course. This action cannot be undone."
              context="Week 1: Introduction, Quiz 1, Assignment 1"
              confirmLabel="Delete Items"
              loading={confirmLoading}
              onConfirm={fakeConfirm}
            />
          </Section>
        </div>

        {/* ── Navigation ── */}
        <div id="navigation" className="space-y-12">
          <Section id="tabs" eyebrow="Navigation" title="Tabs" description="Keyboard navigable (← →). Supports counts and disabled states.">
            <Card elevated>
              <CardBody>
                <Tabs items={TABS} value={activeTab} onChange={setActiveTab} />
                <p className="mt-4 text-sm text-on-surface-variant">Active tab: <strong className="text-on-surface">{activeTab}</strong></p>
              </CardBody>
            </Card>
          </Section>

          <Section id="search" eyebrow="Navigation" title="SearchInput" description="Built-in debounce (250ms default). Clear button. Controlled or uncontrolled.">
            <Card elevated>
              <CardBody className="space-y-4">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search content items…"
                  className="max-w-md"
                />
                <p className="text-sm text-on-surface-variant">
                  Debounced value: <code className="bg-surface-container px-2 py-0.5 rounded text-xs">{search || "(empty)"}</code>
                </p>
                <div className="flex gap-3">
                  <SearchInput placeholder="Small size" size="sm" onChange={() => {}} className="max-w-xs" />
                </div>
              </CardBody>
            </Card>
          </Section>

          <Section id="filterbar" eyebrow="Navigation" title="FilterBar" description="Combines search, filter pills, sort toggles, and a trailing slot.">
            <Card elevated>
              <CardBody>
                <FilterBar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Search modules…"
                  filterOptions={[
                    { value: "all", label: "All", count: 245 },
                    { value: "page", label: "Pages", count: 120 },
                    { value: "assignment", label: "Assignments", count: 58 },
                    { value: "quiz", label: "Quizzes", count: 32 },
                  ]}
                  filterValue={filterValue}
                  onFilterChange={setFilterValue}
                  sortOptions={[
                    { key: "title", label: "Name" },
                    { key: "created_at", label: "Date" },
                    { key: "type", label: "Type" },
                  ]}
                  sortValue={sortValue}
                  sortDirection={sortDir}
                  onSortChange={(key, dir) => { setSortValue(key); setSortDir(dir); }}
                  trailing={<Button variant="ghost" size="sm" icon={<Download size={14} />}>Export</Button>}
                />
              </CardBody>
            </Card>
          </Section>

          <Section id="pagination" eyebrow="Navigation" title="Pagination" description="Previous/next, page indicator, optional jump-to-page.">
            <Card elevated>
              <CardBody className="space-y-5">
                <Pagination
                  page={page}
                  totalPages={24}
                  totalCount={1180}
                  pageSize={50}
                  onPageChange={setPage}
                />
                <Divider />
                <Pagination
                  page={2}
                  totalPages={2}
                  showJump={false}
                  onPageChange={() => {}}
                />
              </CardBody>
            </Card>
          </Section>
        </div>

        {/* ── Data ── */}
        <div id="data" className="space-y-12">
          <Section id="datatable" eyebrow="Data" title="DataTable" description="Sortable columns, row selection, row actions, empty state, loading skeleton, resizable columns.">
            {/* Controls */}
            <div className="mb-4 flex flex-wrap gap-3">
              <Button
                variant={tableLoading ? "secondary" : "ghost"}
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => { setTableLoading(true); setTimeout(() => setTableLoading(false), 2000); }}
              >
                {tableLoading ? "Loading…" : "Simulate Loading"}
              </Button>
              <Button
                variant={tableEmpty ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTableEmpty((v) => !v)}
              >
                {tableEmpty ? "Show Data" : "Simulate Empty"}
              </Button>
            </div>

            <DataTable
              columns={COLUMNS}
              data={tableEmpty ? [] : DEMO_DATA}
              loading={tableLoading}
              skeletonRows={6}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              sortState={sortState}
              onSortChange={setSortState}
              rowActions={[
                { label: "Preview", icon: <Eye size={14} />, onClick: (row) => alert(`Preview: ${row.title}`) },
                { label: "Download", icon: <Download size={14} />, onClick: () => {} },
                { label: "Delete", icon: <Trash2 size={14} />, variant: "destructive", onClick: (row) => alert(`Delete: ${row.title}`) },
              ]}
              emptyIcon={<FileText size={24} />}
              emptyTitle="No content items"
              emptyDescription="Sync a course or adjust your filters."
              emptyAction={<Button variant="primary" size="sm">Sync course</Button>}
              footer={
                <Pagination
                  page={page}
                  totalPages={8}
                  totalCount={DEMO_DATA.length}
                  pageSize={50}
                  onPageChange={setPage}
                />
              }
              resizable
            />

            {/* BulkActionBar */}
            <BulkActionBar
              selectedCount={selectedCount}
              totalCount={DEMO_DATA.length}
              allSelected={selectedCount === DEMO_DATA.length}
              noun="item"
              onSelectAll={() => setSelectedIds(new Set(DEMO_DATA.map((r) => r.id)))}
              onClearSelection={() => setSelectedIds(new Set())}
              actions={[
                { label: "Keep", onClick: () => {} },
                { label: "Defer", onClick: () => {} },
                { label: "Delete", variant: "destructive", icon: <Trash2 size={13} />, onClick: () => setConfirmOpen(true) },
              ]}
            />
          </Section>
        </div>

      </div>
    </div>
  );
}
