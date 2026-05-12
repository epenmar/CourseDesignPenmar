"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckSquare, ExternalLink, Search, Square } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type ContentType = "page" | "assignment" | "discussion" | "quiz";

type MatchPreview = {
  text: string;
  context: string;
};

type SearchResultItem = {
  content_item_id: string;
  canvas_id: string | null;
  content_type: string;
  title: string | null;
  canvas_url: string | null;
  module_name: string | null;
  match_count: number;
  matches: MatchPreview[];
};

type SearchResponse = {
  items: SearchResultItem[];
  total_items: number;
  total_matches: number;
};

type ApplyResponse = {
  applied: Array<{
    content_item_id: string;
    title: string | null;
    replacement_count: number;
    saved: boolean;
    revision_number: number | null;
  }>;
  skipped: Array<{
    content_item_id: string;
    detail: string;
  }>;
  items_modified: number;
  total_replacements: number;
};

const CONTENT_TYPES: Array<{ value: ContentType; label: string }> = [
  { value: "page", label: "Pages" },
  { value: "assignment", label: "Assignments" },
  { value: "discussion", label: "Discussions" },
  { value: "quiz", label: "Quizzes" },
];

function contentTypeLabel(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export default function FindReplaceManager({ sessionId }: { sessionId: string }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [contentTypes, setContentTypes] = useState<Set<ContentType>>(() => new Set(CONTENT_TYPES.map((type) => type.value)));
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedResults = useMemo(
    () => results.filter((item) => selected.has(item.content_item_id)),
    [results, selected],
  );
  const selectedMatchCount = selectedResults.reduce((sum, item) => sum + item.match_count, 0);
  const allSelected = results.length > 0 && results.every((item) => selected.has(item.content_item_id));

  async function getAccessToken() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be signed in.");
    return session.access_token;
  }

  async function runSearch() {
    const nextQuery = query.trim();
    if (!nextQuery) {
      setError("Enter text to find.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/find-replace/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: nextQuery,
          case_sensitive: caseSensitive,
          content_types: Array.from(contentTypes),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Search failed"));
      const data = await res.json() as SearchResponse;
      setResults(data.items);
      setTotalMatches(data.total_matches);
      setSelected(new Set(data.items.map((item) => item.content_item_id)));
      setMessage(data.total_matches ? `Found ${data.total_matches} match${data.total_matches === 1 ? "" : "es"} across ${data.total_items} item${data.total_items === 1 ? "" : "s"}.` : "No matches found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function applySelected() {
    const nextQuery = query.trim();
    if (!nextQuery) {
      setError("Enter text to find.");
      return;
    }
    if (!selected.size) {
      setError("Select at least one content item.");
      return;
    }
    setApplying(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/find-replace/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: nextQuery,
          replacement,
          case_sensitive: caseSensitive,
          content_item_ids: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to send replacements to Pending Review"));
      const data = await res.json() as ApplyResponse;
      setMessage(`Sent ${data.total_replacements} replacement${data.total_replacements === 1 ? "" : "s"} across ${data.items_modified} item${data.items_modified === 1 ? "" : "s"} to Pending Review.`);
      if (data.items_modified > 0) {
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      }
      if (data.applied.length) {
        const appliedIds = new Set(data.applied.map((item) => item.content_item_id));
        setSelected((previous) => new Set(Array.from(previous).filter((id) => !appliedIds.has(id))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send replacements to Pending Review");
    } finally {
      setApplying(false);
    }
  }

  function toggleContentType(value: ContentType) {
    setContentTypes((previous) => {
      const next = new Set(previous);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleResult(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllResults() {
    setSelected(allSelected ? new Set() : new Set(results.map((item) => item.content_item_id)));
  }

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-on-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Course Tools</p>
            <h1 className="mt-1 font-headline text-3xl font-extrabold">Find & Replace</h1>
          </div>
          <Link
            href={`/sessions/${sessionId}/edit`}
            className="inline-flex h-10 items-center rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
          >
            Pending Review
          </Link>
        </div>

        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Find
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                className="mt-1 h-11 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface outline-none focus:border-primary"
                placeholder="Text across course content"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Replace
              <input
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface outline-none focus:border-primary"
                placeholder="Replacement text"
              />
            </label>
            <button
              type="button"
              disabled={loading || !query.trim() || contentTypes.size === 0}
              onClick={() => void runSearch()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search size={16} />
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {CONTENT_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => toggleContentType(type.value)}
                className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold transition-colors ${
                  contentTypes.has(type.value)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-outline-variant/40 bg-white text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {type.label}
              </button>
            ))}
            <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-outline-variant/40 bg-white px-3 text-xs font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Match case
            </label>
          </div>
          <p className="mt-3 text-xs text-on-surface-variant">
            Replacements are saved as pending content revisions. Review and push them from Edit before Canvas is changed.
          </p>
        </section>

        {error ? (
          <div className="rounded-2xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-on-surface">
            {message}
          </div>
        ) : null}

        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/30 px-4 py-3">
            <button
              type="button"
              disabled={!results.length}
              onClick={toggleAllResults}
              className="inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              {allSelected ? "Clear selection" : "Select all"}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-on-surface-variant">
                {selected.size} selected / {selectedMatchCount} matching replacement{selectedMatchCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                disabled={applying || !selected.size || !query.trim()}
                onClick={() => void applySelected()}
                className="inline-flex h-10 items-center rounded-xl bg-secondary-container px-4 text-sm font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applying ? "Sending..." : "Send selected to Pending Review"}
              </button>
            </div>
          </div>

          {results.length ? (
            <div className="divide-y divide-outline-variant/20">
              {results.map((item) => {
                const checked = selected.has(item.content_item_id);
                return (
                  <article key={item.content_item_id} className="grid gap-4 px-4 py-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <button
                      type="button"
                      onClick={() => toggleResult(item.content_item_id)}
                      className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-container-low text-primary transition-colors hover:bg-surface-container-high"
                      aria-label={checked ? "Deselect item" : "Select item"}
                    >
                      {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-headline text-lg font-bold text-on-surface">
                          {item.title || "Untitled content"}
                        </h2>
                        <span className="rounded-full bg-surface-container-low px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                          {contentTypeLabel(item.content_type)}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {item.match_count} match{item.match_count === 1 ? "" : "es"}
                        </span>
                      </div>
                      {item.module_name ? (
                        <p className="mt-1 text-sm text-on-surface-variant">{item.module_name}</p>
                      ) : null}
                      <div className="mt-3 space-y-2">
                        {item.matches.map((match, index) => (
                          <p key={`${item.content_item_id}-${index}`} className="rounded-xl bg-surface-container-low px-3 py-2 text-sm leading-6 text-on-surface">
                            {match.context}
                          </p>
                        ))}
                        {item.match_count > item.matches.length ? (
                          <p className="text-xs font-semibold text-on-surface-variant">
                            +{item.match_count - item.matches.length} more match{item.match_count - item.matches.length === 1 ? "" : "es"} in this item
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                      <Link
                        href={`/sessions/${sessionId}/edit?item=${item.content_item_id}`}
                        className="inline-flex h-9 items-center rounded-xl bg-surface-container-low px-3 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                      >
                        Edit
                      </Link>
                      {item.canvas_url ? (
                        <a
                          href={item.canvas_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1 rounded-xl bg-surface-container-low px-3 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                        >
                          Canvas
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="font-semibold text-on-surface">No search results yet</p>
              <p className="mt-1 text-sm text-on-surface-variant">
                Search for visible text across selected content types.
              </p>
            </div>
          )}
        </section>

        {results.length ? (
          <p className="text-sm text-on-surface-variant">
            Showing {results.length} matching item{results.length === 1 ? "" : "s"} and {totalMatches} total match{totalMatches === 1 ? "" : "es"}.
          </p>
        ) : null}
      </div>
    </main>
  );
}
