# Missing Components Worth Building

## High-Impact Patterns (Build Next)

### 1. **Tabs / Tab Navigation**
**Usage:** InventoryTable (content type filters), DocumentsManager (status filters), FindReplaceManager (content type filters)

**Pattern:**
```tsx
const [tab, setTab] = useState("all");
const tabs = [
  { value: "all", label: "All", count: 245 },
  { value: "pages", label: "Pages", count: 120 },
  { value: "assignments", label: "Assignments", count: 45 }
];
```

**Recommendation:** Build a `<Tabs>` component with:
- Tab buttons with optional badge counts
- Keyboard navigation (arrows, Enter)
- Active indicator + underline
- EdPlus styling (12px font, maroon underline on active)

---

### 2. **Filter / Search Toolbar**
**Usage:** InventoryTable, DocumentsManager, FindReplaceManager, LinksManager

**Pattern:**
```tsx
const [draftQuery, setDraftQuery] = useState("");
const [query, setQuery] = useState("");
const [contentType, setContentType] = useState("all");
const [sortKey, setSortKey] = useState("created_at");
```

**Recommendation:** Build a `<FilterBar>` component with:
- Search input with 250ms debounce built-in
- Multi-select dropdown (content types, statuses)
- Sort button with ASC/DESC toggle
- Clear all button
- Compact, horizontal layout

---

### 3. **Pagination Controls**
**Usage:** InventoryTable (explicit), DocumentsManager (explicit), likely others

**Pattern:**
```tsx
const [offset, setOffset] = useState(0);
const PAGE_SIZE = 50;
const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
const totalPages = Math.ceil(totalCount / PAGE_SIZE);
```

**Recommendation:** Build a `<Pagination>` component with:
- Previous / Next buttons
- Jump to page input
- "Page X of Y" display
- Disabled state on boundaries
- EdPlus button styling

---

### 4. **Bulk Action Bar** (Selection Toolbar)
**Usage:** InventoryTable (selectedIds), FindReplaceManager (selected), DocumentsManager (likely)

**Pattern:**
```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const selectedCount = selectedIds.size;
const allPageSelected = items.every(item => selectedIds.has(item.id));

// Render
{selectedCount > 0 && (
  <div className="sticky bottom-0 bg-surface-container-low p-4">
    <p>{selectedCount} selected</p>
    <button onClick={handleBulkDelete}>Delete ({selectedCount})</button>
    <button onClick={handleClearSelection}>Clear</button>
  </div>
)}
```

**Recommendation:** Build a `<BulkActionBar>` component with:
- Selection count display
- "Select All / Clear All" toggle
- Action buttons (Delete, Approve, Reject, Export, etc.)
- Sticky positioning (stays visible while scrolling)
- Confirmation modal before destructive actions

---

### 5. **Data Table / Sortable Table**
**Usage:** InventoryTable (870 lines!), DocumentsManager (1265 lines!), ModuleItemReorderRow

**Pattern:**
```tsx
const [sortKey, setSortKey] = useState("created_at");
const [sortDirection, setSortDirection] = useState("desc");

function handleSort(key) {
  if (sortKey === key) {
    setSortDirection(current => current === "asc" ? "desc" : "asc");
  } else {
    setSortKey(key);
    setSortDirection("asc");
  }
}
```

**Recommendation:** Build a `<DataTable>` component with:
- Column headers with click-to-sort
- Sort direction indicators (↑/↓)
- Optional row selection (checkboxes)
- Responsive column widths (like InventoryTable's resizable columns)
- Pagination integration
- Empty state handling
- Loading skeleton option
- Row hover highlight

**This is your biggest opportunity** — InventoryTable and DocumentsManager are massive and mostly table logic. Extract it into a reusable `<DataTable columns={[...]} data={[...]} onSort={...} />` component.

---

### 6. **Empty State**
**Usage:** All tables/lists (implicit, currently handled ad-hoc)

**Pattern:**
```tsx
if (items.length === 0) {
  return <div className="text-center py-12">
    <p>No results found</p>
  </div>;
}
```

**Recommendation:** Build an `<EmptyState>` component with:
- Icon (SVG)
- Title
- Description
- Optional action button (New, Import, etc.)
- EdPlus styling (generous spacing, muted colors)

---

### 7. **Loading Skeleton / Skeleton Loader**
**Usage:** All data-fetching components (currently just `loading` boolean)

**Pattern:**
```tsx
if (loading) return <div>Loading...</div>;
```

**Recommendation:** Build a `<TableSkeleton>` with:
- Shimmer animation
- Configurable row count
- Column widths that match actual table
- Reduces perceived load time

---

### 8. **Status Badge / Status Pill**
**Usage:** DocumentsManager (accessibility_status, replacement_deployed, cleanup_marked), InventoryTable (decision_action: keep/delete/defer)

**Pattern:**
```tsx
const statusClass = {
  "passed": "bg-green-50 text-green-700",
  "failed": "bg-error-container text-error",
  "pending": "bg-yellow-50 text-yellow-700"
};
```

**Recommendation:** Already have Badge, but consider a specialized `<StatusBadge>` that:
- Auto-maps status codes to colors + icons
- Includes optional tooltip
- EdPlus color convention (maroon for primary, error red for destructive, etc.)

---

### 9. **Search Input with Debounce**
**Usage:** InventoryTable (draftQuery/query pattern), FindReplaceManager, DocumentsManager

**Pattern:**
```tsx
const [draftQuery, setDraftQuery] = useState("");
const [query, setQuery] = useState("");

useEffect(() => {
  const timer = window.setTimeout(() => {
    setQuery(draftQuery);
  }, 250);
  return () => clearTimeout(timer);
}, [draftQuery]);
```

**Recommendation:** Wrap this into a `<SearchInput>` component that:
- Handles debounce internally (configurable delay)
- Clears button (X icon)
- Search icon in leading position
- EdPlus Input styling

---

### 10. **Confirmation Dialog / Destructive Action Modal**
**Usage:** InventoryTable (pending decision), DocumentsManager (archive, cleanup), FindReplaceManager (apply replacements)

**Pattern:**
```tsx
const [pendingDecision, setPendingDecision] = useState(null);

if (pendingDecision) {
  return <Modal>
    <h2>Are you sure?</h2>
    <p>This action cannot be undone.</p>
    <Button onClick={confirm}>Delete</Button>
    <Button onClick={cancel}>Cancel</Button>
  </Modal>;
}
```

**Recommendation:** Build a `<ConfirmDialog>` component with:
- Title, description, item context
- Destructive action button (red)
- Cancel button
- Optional loading state on confirm
- Auto-focus cancel button (accessibility)

---

## Component Priority & ROI

| Component | Lines Saved | Used In | Complexity | Build Time |
|-----------|------------|---------|-----------|-----------|
| **DataTable** | 500–600 | 2 major | High | 4–6 hrs |
| **FilterBar** | 100–150 | 4+ | Medium | 2–3 hrs |
| **Tabs** | 50–80 | 3+ | Low | 1–1.5 hrs |
| **BulkActionBar** | 80–120 | 2+ | Medium | 2 hrs |
| **Pagination** | 40–60 | 2+ | Low | 1 hr |
| **ConfirmDialog** | 60–100 | 3+ | Medium | 1.5 hrs |
| **SearchInput** | 30–50 | 3+ | Low | 0.5–1 hr |
| **EmptyState** | 20–40 | 4+ | Low | 0.5 hr |
| **StatusBadge** | 15–30 | 2+ | Low | 0.5 hr |
| **Skeleton** | 30–60 | 4+ | Medium | 1.5 hrs |

---

## Recommended Build Order (Next Sprint)

1. **Tabs** (1.5 hrs) — unblocks FilterBar
2. **Pagination** (1 hr) — unblocks DataTable
3. **DataTable** (5 hrs) — refactor InventoryTable + DocumentsManager
4. **FilterBar** (2.5 hrs) — consolidate search/sort logic
5. **BulkActionBar** (2 hrs) — InventoryTable + DocumentsManager patterns
6. **ConfirmDialog** (1.5 hrs) — all destructive actions
7. **SearchInput** (1 hr) — replace debounce patterns
8. **EmptyState** + **Skeleton** (1.5 hrs) — polish

**Total: ~16 hours** for massive ROI (200+ lines removed from existing components, consistent patterns across the app)

---

## Implementation Notes

- All components should follow EdPlus styling (use color tokens, 12px border radius, -0.02em tracking)
- Use your existing `Button`, `Input`, `Modal` components as building blocks
- Keep components **headless** where possible — pass `onSort()`, `onFilterChange()`, etc. as props
- DataTable should support: sorting, selection, pagination, row actions, custom cells
- All should be in `frontend/src/components/edplus/` alongside existing components
