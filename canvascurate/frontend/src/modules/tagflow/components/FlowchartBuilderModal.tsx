"use client";

/**
 * Shared flowchart structure editor modal for PDF figures and TagFlow zones.
 *
 * Provides the manual node/connection editor that the future visual annotator
 * can extend without growing the document detail or TagFlow page components.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";

import type { FlowchartConnection, FlowchartNode, FlowchartStructure } from "../types";

type FlowchartBuilderModalProps = {
  title?: string;
  subtitle?: string;
  preview: ReactNode;
  structure: FlowchartStructure;
  guidance: string;
  saving?: boolean;
  saveLabel?: string;
  closeLabel?: string;
  zIndexClassName?: string;
  onGuidanceChange: (value: string) => void;
  onAddNode: () => void;
  onUpdateNode: (nodeId: string, patch: Partial<FlowchartNode>) => void;
  onRemoveNode: (nodeId: string) => void;
  onAddConnection: () => void;
  onUpdateConnection: (connectionId: string, patch: Partial<FlowchartConnection>) => void;
  onRemoveConnection: (connectionId: string) => void;
  onClose: () => void;
  onSave?: () => void;
};

export default function FlowchartBuilderModal({
  title = "Flowchart builder",
  subtitle,
  preview,
  structure,
  guidance,
  saving = false,
  saveLabel = "Save structure",
  closeLabel = "Close",
  zIndexClassName = "z-50",
  onGuidanceChange,
  onAddNode,
  onUpdateNode,
  onRemoveNode,
  onAddConnection,
  onUpdateConnection,
  onRemoveConnection,
  onClose,
  onSave,
}: FlowchartBuilderModalProps) {
  const nodes = structure.nodes ?? [];
  const canAddConnection = nodes.length >= 2;

  return (
    <div className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-on-surface/55 px-4 py-8`} role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-[92rem] flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-5 py-4">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:text-on-surface"
            aria-label="Close flowchart builder"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(560px,1.45fr)_minmax(360px,0.75fr)]">
          <div className="min-h-0 overflow-auto border-b border-outline-variant/40 bg-surface-container-low p-4 lg:border-b-0 lg:border-r">
            {preview}
          </div>
          <div className="min-h-0 overflow-auto p-5">
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-variant">Flowchart guidance</span>
              <textarea
                value={guidance}
                onChange={(event) => onGuidanceChange(event.target.value)}
                rows={3}
                className="mt-1 w-full resize-y rounded-xl border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                placeholder="Example: Start -> Decision; Decision -> Yes path; Decision -> No path"
              />
            </label>

            <div className="mt-5 rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-on-surface">Nodes</h3>
                  <p className="mt-1 text-xs text-on-surface-variant">Capture each meaningful step, decision, or endpoint.</p>
                </div>
                <button
                  type="button"
                  onClick={onAddNode}
                  className="rounded-xl border border-outline-variant/60 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-lowest"
                >
                  Add node
                </button>
              </div>
              {nodes.length ? (
                <div className="mt-3 space-y-3">
                  {nodes.map((node, nodeIndex) => (
                    <div key={node.id} className="rounded-xl bg-surface-container-lowest p-3">
                      <div className="grid grid-cols-[4rem_1fr_auto] gap-2">
                        <input
                          type="number"
                          min={1}
                          max={300}
                          value={node.reading_order}
                          onChange={(event) => onUpdateNode(node.id, { reading_order: Number(event.target.value || nodeIndex + 1) })}
                          className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-2 py-2 text-sm text-on-surface outline-none focus:border-primary"
                          aria-label={`Reading order for ${node.label || `node ${nodeIndex + 1}`}`}
                        />
                        <input
                          value={node.label}
                          onChange={(event) => onUpdateNode(node.id, { label: event.target.value })}
                          className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                          placeholder={`Node ${nodeIndex + 1} label`}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveNode(node.id)}
                          className="rounded-lg px-2 text-xs font-semibold text-error transition-colors hover:bg-error-container/30"
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        value={node.description ?? ""}
                        onChange={(event) => onUpdateNode(node.id, { description: event.target.value })}
                        rows={2}
                        className="mt-2 w-full resize-y rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        placeholder="Node meaning or visible text"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
                  No nodes added.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-on-surface">Connections</h3>
                  <p className="mt-1 text-xs text-on-surface-variant">Map arrows, branches, and relationships between nodes.</p>
                </div>
                <button
                  type="button"
                  onClick={onAddConnection}
                  disabled={!canAddConnection}
                  className="rounded-xl border border-outline-variant/60 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-lowest disabled:opacity-50"
                >
                  Add connection
                </button>
              </div>
              {structure.connections.length ? (
                <div className="mt-3 space-y-3">
                  {structure.connections.map((connection) => (
                    <div key={connection.id} className="rounded-xl bg-surface-container-lowest p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <select
                          value={connection.from_node_id}
                          onChange={(event) => onUpdateConnection(connection.id, { from_node_id: event.target.value })}
                          className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        >
                          {nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                        </select>
                        <select
                          value={connection.to_node_id}
                          onChange={(event) => onUpdateConnection(connection.id, { to_node_id: event.target.value })}
                          className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        >
                          {nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                        </select>
                      </div>
                      <input
                        value={connection.label ?? ""}
                        onChange={(event) => onUpdateConnection(connection.id, { label: event.target.value })}
                        className="mt-2 w-full rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        placeholder="Connection label, such as Yes or No"
                      />
                      <textarea
                        value={connection.description ?? ""}
                        onChange={(event) => onUpdateConnection(connection.id, { description: event.target.value })}
                        rows={2}
                        className="mt-2 w-full resize-y rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        placeholder="Relationship or transition details"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveConnection(connection.id)}
                        className="mt-2 text-xs font-semibold text-error"
                      >
                        Remove connection
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
                  Add at least two nodes before creating connections.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-outline-variant/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-outline-variant/60 px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            {closeLabel}
          </button>
          {onSave ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-50"
            >
              {saving ? "Saving" : saveLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
