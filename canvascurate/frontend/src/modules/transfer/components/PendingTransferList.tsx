/**
 * Lists content, module operations, and deletion candidates for Transfer review.
 */

import { AlertTriangle, FileText, Layers, Link2Off } from "lucide-react";
import Badge from "@/components/edplus/Badge";
import Card from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";
import type { TransferDeletionItem, TransferIssue, TransferModuleOperation, TransferPendingItem } from "../types";

function TransferBadge({ children }: { children: string }) {
  return (
    <Badge className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">
      {children}
    </Badge>
  );
}

function EmptyRow({ children }: { children: string }) {
  return (
    <Card>
      <EmptyState title={children} size="sm" />
    </Card>
  );
}

export function PendingContentList({ items }: { items: TransferPendingItem[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <FileText size={20} className="text-primary" />
        <h4 className="font-headline text-lg font-bold text-on-surface">Modified Content to Push</h4>
      </div>
      {items.length ? (
        <Card className="overflow-hidden">
          {items.map((item, index) => (
            <div key={item.id} className={`flex items-center justify-between gap-4 p-4 ${index ? "border-t border-outline-variant/10" : ""}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-on-surface">{item.title}</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {item.content_type}{item.module_name ? ` | ${item.module_name}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.badges.map((badge) => <TransferBadge key={badge}>{badge}</TransferBadge>)}
                </div>
              </div>
              <span className="text-xs font-bold text-primary">{item.revision_count ?? 0} rev</span>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyRow>No modified or generated content is currently ready for transfer.</EmptyRow>
      )}
    </section>
  );
}

export function ModuleOperationList({ operations }: { operations: TransferModuleOperation[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Layers size={20} className="text-primary" />
        <h4 className="font-headline text-lg font-bold text-on-surface">Module Operations to Apply</h4>
      </div>
      {operations.length ? (
        <Card className="overflow-hidden">
          {operations.map((operation, index) => (
            <div key={operation.id} className={`p-4 ${index ? "border-t border-outline-variant/10" : ""}`}>
              <p className="text-sm font-bold text-on-surface">{operation.title || operation.operation_type}</p>
              <p className="mt-1 text-xs text-on-surface-variant">{operation.detail || operation.operation_type}</p>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyRow>No staged module operations are waiting for transfer.</EmptyRow>
      )}
    </section>
  );
}

export function DeletionCandidateList({ items }: { items: TransferDeletionItem[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Link2Off size={20} className="text-error" />
        <h4 className="font-headline text-lg font-bold text-on-surface">Orphaned Content to Review</h4>
      </div>
      {items.length ? (
        <Card className="overflow-hidden border-dashed bg-surface-container-low/50">
          {items.map((item, index) => (
            <div key={item.id} className={`flex items-center justify-between gap-4 p-4 opacity-75 ${index ? "border-t border-outline-variant/20" : ""}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-on-surface">{item.title}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{item.reason || item.content_type}</p>
              </div>
              <span className="text-[10px] font-bold uppercase text-error">{item.action}</span>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyRow>No deletion candidates are currently staged for transfer.</EmptyRow>
      )}
    </section>
  );
}

export function TransferIssueList({ items }: { items: TransferIssue[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <AlertTriangle size={20} className="text-secondary" />
        <h4 className="font-headline text-lg font-bold text-on-surface">Transfer Exceptions</h4>
      </div>
      {items.length ? (
        <Card className="overflow-hidden border-secondary/30 bg-secondary-container/15">
          {items.map((item, index) => (
            <div key={item.id} className={`p-4 ${index ? "border-t border-secondary/20" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-on-surface">{item.title}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">{item.reason}</p>
                  {item.impact ? <p className="mt-1 text-xs text-on-surface-variant">{item.impact}</p> : null}
                </div>
                <Badge className="flex-none bg-surface-container-lowest px-2 py-0.5 text-[9px] font-bold uppercase text-on-surface-variant">
                  {item.content_type}
                </Badge>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyRow>No known exceptions are expected for the current Transfer slice.</EmptyRow>
      )}
    </section>
  );
}
