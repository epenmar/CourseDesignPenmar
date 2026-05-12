/**
 * Reference review panel for document detail.
 *
 * Lists stored course content links that point at the current Canvas file.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";

type LinkedFrom = {
  content_item_id: string;
  content_title: string | null;
  content_type: string;
  content_canvas_url: string | null;
  module_name: string | null;
  link_index: number;
  href: string;
  text: string | null;
  issue_code: string | null;
};

function contentTypeLabel(contentType: string) {
  return contentType.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function issueLabel(issueCode: string | null) {
  if (!issueCode) return "Clear";
  return issueCode.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default function ReferenceReviewPanel({ linkedFrom, children }: { linkedFrom: LinkedFrom[]; children?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div>
          <h2 className="font-headline text-xl font-bold text-on-surface">Reference Review</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Content locations that currently point to this Canvas file.</p>
        </div>
        <Link2 className="text-primary" size={22} />
      </div>
      {linkedFrom.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">No links to this file were found in stored page, assignment, discussion, or quiz HTML.</p>
      ) : (
        <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
          {linkedFrom.map((link) => (
            <div key={`${link.content_item_id}:${link.link_index}:${link.href}`} className="rounded-2xl border border-outline-variant/35 bg-surface-container-low p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-on-surface">{link.content_title || "Untitled content"}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {contentTypeLabel(link.content_type)}
                    {link.module_name ? ` / ${link.module_name}` : ""}
                    {` / Link #${link.link_index}`}
                  </p>
                </div>
                {link.content_canvas_url ? (
                  <Link href={link.content_canvas_url} target="_blank" className="text-xs font-semibold text-primary hover:underline">
                    Open source
                  </Link>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-container-lowest px-3 py-1 text-xs text-on-surface-variant">
                  {link.text || "No readable link text"}
                </span>
                {link.issue_code ? (
                  <span className="rounded-full bg-error-container px-3 py-1 text-xs font-semibold text-error">
                    {issueLabel(link.issue_code)}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {children ? (
        <div className="mt-5 border-t border-outline-variant/40 pt-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
