"use client";

/**
 * Visual flowchart annotator for TagFlow and PDF figure remediation.
 *
 * Provides image-relative node placement, role marking, drag/resize editing,
 * and click-to-connect relationships backed by the shared flowchart structure.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, HelpCircle, Maximize2, Plus, RotateCcw, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react";

import Tooltip from "@/components/ui/Tooltip";
import type { FlowchartConnection, FlowchartNode, FlowchartStructure } from "../types";
import { flowchartGuidanceFromStructure, normalizeFlowchartStructure } from "../utils";

type PercentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState =
  | { kind: "move"; nodeId: string; startX: number; startY: number; startBounds: PercentBounds; moved: boolean }
  | { kind: "resize"; nodeId: string; startX: number; startY: number; startBounds: PercentBounds; moved: boolean }
  | null;

type FlowchartVisualAnnotatorProps = {
  imageSrc: string;
  imageAlt?: string;
  structure: FlowchartStructure;
  guidance: string;
  focusBounds?: PercentBounds | null;
  onStructureChange: (structure: FlowchartStructure) => void;
  onGuidanceChange?: (guidance: string) => void;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultNodeBounds(index: number): PercentBounds {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: clamp(8 + column * 28, 0, 84),
    y: clamp(10 + row * 16, 0, 92),
    width: 18,
    height: 8,
  };
}

function nodeBounds(node: FlowchartNode, index: number): PercentBounds {
  return node.bounds ?? defaultNodeBounds(index);
}

function nodeCenter(node: FlowchartNode, index: number) {
  const bounds = nodeBounds(node, index);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function nextRole(role: FlowchartNode["role"]): FlowchartNode["role"] {
  if (role === "start") return "independent";
  if (role === "independent") return "end";
  if (role === "end") return "intermediate";
  return "start";
}

function roleTitle(role: FlowchartNode["role"]) {
  if (role === "start") return "Start node. The flow begins here.";
  if (role === "independent") return "Independent node. This is separate from the main path.";
  if (role === "end") return "End node. The flow terminates here.";
  return "Intermediate node. This is a normal step, process, or decision.";
}

function nodeClasses(node: FlowchartNode, selected: boolean) {
  if (selected) return "border-primary bg-primary/25 text-on-surface";
  if (node.role === "start") return "border-green-600 bg-green-500/20 text-on-surface";
  if (node.role === "end") return "border-red-600 bg-red-500/20 text-on-surface";
  if (node.role === "independent") return "border-purple-600 bg-purple-500/20 text-on-surface";
  return "border-tertiary bg-tertiary/20 text-on-surface";
}

export default function FlowchartVisualAnnotator({
  imageSrc,
  imageAlt = "",
  structure,
  guidance,
  focusBounds,
  onStructureChange,
  onGuidanceChange,
}: FlowchartVisualAnnotatorProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const normalized = useMemo(() => normalizeFlowchartStructure(structure, guidance), [structure, guidance]);
  const nodes = normalized.nodes;
  const nodeIndexById = useMemo(() => new Map(nodes.map((node, index) => [node.id, index])), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  function emit(next: FlowchartStructure) {
    onStructureChange(normalizeFlowchartStructure(next, guidance));
  }

  function updateNode(nodeId: string, patch: Partial<FlowchartNode>) {
    emit({
      ...normalized,
      nodes: nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    });
  }

  function addNodeAt(x: number, y: number) {
    const nextIndex = nodes.length + 1;
    const width = 18;
    const height = 8;
    const id = `node-${Date.now()}`;
    const node: FlowchartNode = {
      id,
      label: `Step ${nextIndex}`,
      description: "",
      reading_order: nextIndex,
      role: "intermediate",
      bounds: {
        x: clamp(x - width / 2, 0, 100 - width),
        y: clamp(y - height / 2, 0, 100 - height),
        width,
        height,
      },
    };
    emit({
      ...normalized,
      nodes: [...nodes, node],
      reading_order: [...(normalized.reading_order ?? []), id],
    });
    setSelectedSourceId(id);
  }

  function removeNode(nodeId: string) {
    const nextNodes = nodes.filter((node) => node.id !== nodeId).map((node, index) => ({ ...node, reading_order: index + 1 }));
    emit({
      ...normalized,
      nodes: nextNodes,
      connections: normalized.connections.filter((connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId),
      reading_order: nextNodes.map((node) => node.id),
    });
    if (selectedSourceId === nodeId) setSelectedSourceId(null);
  }

  function connectNodes(fromNodeId: string, toNodeId: string) {
    if (fromNodeId === toNodeId) return;
    const exists = normalized.connections.some((connection) => connection.from_node_id === fromNodeId && connection.to_node_id === toNodeId);
    if (exists) return;
    emit({
      ...normalized,
      connections: [
        ...normalized.connections,
        {
          id: `connection-${Date.now()}`,
          from_node_id: fromNodeId,
          to_node_id: toNodeId,
          label: "",
          description: "",
          order: normalized.connections.length + 1,
        },
      ],
    });
  }

  function removeConnection(connectionId: string) {
    emit({
      ...normalized,
      connections: normalized.connections
        .filter((connection) => connection.id !== connectionId)
        .map((connection, index) => ({ ...connection, order: index + 1 })),
    });
  }

  function handleNodeClick(nodeId: string) {
    if (!selectedSourceId) {
      setSelectedSourceId(nodeId);
      return;
    }
    if (selectedSourceId === nodeId) {
      setSelectedSourceId(null);
      return;
    }
    connectNodes(selectedSourceId, nodeId);
    setSelectedSourceId(null);
  }

  function relativePoint(event: MouseEvent<HTMLDivElement>) {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const point = relativePoint(event);
    if (!point) return;
    addNodeAt(point.x, point.y);
  }

  function startMove(event: MouseEvent<HTMLDivElement>, node: FlowchartNode, nodeIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging({
      kind: "move",
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: nodeBounds(node, nodeIndex),
      moved: false,
    });
  }

  function startResize(event: MouseEvent<HTMLDivElement>, node: FlowchartNode, nodeIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging({
      kind: "resize",
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: nodeBounds(node, nodeIndex),
      moved: false,
    });
  }

  useEffect(() => {
    if (!dragging) return;
    const activeDrag = dragging;

    function handleMouseMove(event: globalThis.MouseEvent) {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const deltaX = ((event.clientX - activeDrag.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - activeDrag.startY) / rect.height) * 100;
      const moved = Math.abs(event.clientX - activeDrag.startX) + Math.abs(event.clientY - activeDrag.startY) > 4;
      if (activeDrag.kind === "move") {
        const nextBounds = {
          ...activeDrag.startBounds,
          x: clamp(activeDrag.startBounds.x + deltaX, 0, 100 - activeDrag.startBounds.width),
          y: clamp(activeDrag.startBounds.y + deltaY, 0, 100 - activeDrag.startBounds.height),
        };
        updateNode(activeDrag.nodeId, { bounds: nextBounds });
      } else {
        const nextBounds = {
          ...activeDrag.startBounds,
          width: clamp(activeDrag.startBounds.width + deltaX, 4, 100 - activeDrag.startBounds.x),
          height: clamp(activeDrag.startBounds.height + deltaY, 4, 100 - activeDrag.startBounds.y),
        };
        updateNode(activeDrag.nodeId, { bounds: nextBounds });
      }
      if (moved) setDragging((current) => current ? { ...current, moved: true } : current);
    }

    function handleMouseUp() {
      if (activeDrag.kind === "move" && !activeDrag.moved) handleNodeClick(activeDrag.nodeId);
      setDragging(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, normalized, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const visualBounds = focusBounds ?? { x: 0, y: 0, width: 100, height: 100 };

  return (
    <div className="flex h-full min-h-[460px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-1 py-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Math.round((value - ZOOM_STEP) * 100) / 100))}
            disabled={zoom <= MIN_ZOOM}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <span className="w-12 text-center text-xs font-semibold text-on-surface-variant">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Math.round((value + ZOOM_STEP) * 100) / 100))}
            disabled={zoom >= MAX_ZOOM}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            title="Reset zoom"
            aria-label="Reset zoom"
          >
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip
            align="end"
            content={(
              <span>
                Node roles: arrow means start, I means independent, square means end, and an empty marker means a normal intermediate node. Click the marker or right-click a node to cycle roles.
              </span>
            )}
          >
            <span
              tabIndex={0}
              className="inline-flex rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-2 text-on-surface-variant outline-none transition-colors hover:bg-surface-container-low focus:border-primary focus:text-on-surface"
              aria-label="Flowchart node role help"
            >
              <HelpCircle size={16} />
            </span>
          </Tooltip>
          <button
            type="button"
            onClick={() => addNodeAt(50, 50)}
            className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-2 text-on-surface transition-colors hover:bg-surface-container-low"
            title="Add node"
            aria-label="Add node"
          >
            <Plus size={16} />
          </button>
          {onGuidanceChange ? (
            <button
              type="button"
              onClick={() => onGuidanceChange(flowchartGuidanceFromStructure(normalized, guidance))}
              className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              Update guidance
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-surface-container-lowest p-3">
        <div className="relative inline-block max-w-full" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated previews and signed assets are rendered at their intrinsic image ratio. */}
          <img src={imageSrc} alt={imageAlt} className="block max-h-[68vh] w-auto max-w-full rounded-xl border border-outline-variant/40 object-contain" draggable={false} />
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute border-2 border-primary/80 bg-primary/5"
              style={{
                left: `${visualBounds.x}%`,
                top: `${visualBounds.y}%`,
                width: `${visualBounds.width}%`,
                height: `${visualBounds.height}%`,
              }}
            />
          </div>
          <div
            ref={areaRef}
            className="absolute"
            style={{
              left: `${visualBounds.x}%`,
              top: `${visualBounds.y}%`,
              width: `${visualBounds.width}%`,
              height: `${visualBounds.height}%`,
            }}
            onDoubleClick={handleDoubleClick}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <marker id="flowchart-arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#6750a4" />
                </marker>
                <marker id="flowchart-arrowhead-hover" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#ba1a1a" />
                </marker>
              </defs>
              {normalized.connections.map((connection) => {
                const source = nodeById.get(connection.from_node_id);
                const target = nodeById.get(connection.to_node_id);
                if (!source || !target) return null;
                const sourceIndex = nodeIndexById.get(source.id) ?? 0;
                const targetIndex = nodeIndexById.get(target.id) ?? 0;
                const sourceCenter = nodeCenter(source, sourceIndex);
                const targetCenter = nodeCenter(target, targetIndex);
                const hovered = hoveredConnectionId === connection.id;
                return (
                  <g key={connection.id}>
                    <line
                      x1={`${sourceCenter.x}%`}
                      y1={`${sourceCenter.y}%`}
                      x2={`${targetCenter.x}%`}
                      y2={`${targetCenter.y}%`}
                      stroke="transparent"
                      strokeWidth={14}
                      className="pointer-events-auto cursor-pointer"
                      onMouseEnter={() => setHoveredConnectionId(connection.id)}
                      onMouseLeave={() => setHoveredConnectionId(null)}
                      onClick={() => removeConnection(connection.id)}
                    />
                    <line
                      x1={`${sourceCenter.x}%`}
                      y1={`${sourceCenter.y}%`}
                      x2={`${targetCenter.x}%`}
                      y2={`${targetCenter.y}%`}
                      stroke={hovered ? "#ba1a1a" : "#6750a4"}
                      strokeWidth={hovered ? 3 : 2}
                      strokeDasharray={hovered ? "none" : "5 3"}
                      markerEnd={hovered ? "url(#flowchart-arrowhead-hover)" : "url(#flowchart-arrowhead)"}
                    />
                  </g>
                );
              })}
            </svg>
            {nodes.map((node, nodeIndex) => {
              const bounds = nodeBounds(node, nodeIndex);
              const selected = selectedSourceId === node.id;
              return (
                <div
                  key={node.id}
                  className={`absolute flex cursor-grab select-none items-center justify-center rounded border-2 px-1 text-center text-[10px] font-semibold leading-tight shadow-sm ${nodeClasses(node, selected)}`}
                  style={{
                    left: `${bounds.x}%`,
                    top: `${bounds.y}%`,
                    width: `${bounds.width}%`,
                    height: `${bounds.height}%`,
                    minWidth: 36,
                    minHeight: 22,
                  }}
                  onMouseDown={(event) => startMove(event, node, nodeIndex)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    updateNode(node.id, { role: nextRole(node.role) });
                  }}
                  title={node.label}
                >
                  <span className="line-clamp-2">{node.label}</span>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateNode(node.id, { role: nextRole(node.role) });
                    }}
                    className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-[9px] font-bold text-on-surface shadow-sm"
                    title={`${roleTitle(node.role)} Click to cycle node role.`}
                    aria-label={`${roleTitle(node.role)} Click to cycle node role.`}
                  >
                    {node.role === "start" ? <ArrowRight size={10} /> : node.role === "end" ? <Square size={9} /> : node.role === "independent" ? "I" : ""}
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeNode(node.id);
                    }}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-error text-on-error shadow-sm"
                    title="Remove node"
                    aria-label="Remove node"
                  >
                    <Trash2 size={10} />
                  </button>
                  <div
                    className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-br border-b-2 border-r-2 border-primary"
                    onMouseDown={(event) => startResize(event, node, nodeIndex)}
                    title="Resize node"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid max-h-36 gap-3 overflow-hidden lg:grid-cols-2">
        <div className="min-h-0 overflow-auto rounded-xl border border-outline-variant/45 bg-surface-container-lowest p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Nodes</h3>
            {nodes.length ? (
              <button
                type="button"
                onClick={() => {
                  emit({
                    ...normalized,
                    nodes: nodes.map((node, index) => ({ ...node, bounds: defaultNodeBounds(index), reading_order: index + 1 })),
                    reading_order: nodes.map((node) => node.id),
                  });
                }}
                className="text-on-surface-variant transition-colors hover:text-on-surface"
                title="Reset node positions"
                aria-label="Reset node positions"
              >
                <RotateCcw size={13} />
              </button>
            ) : null}
          </div>
          {nodes.length ? nodes.map((node) => (
            <div key={node.id} className="flex items-center gap-2 py-1 text-xs text-on-surface-variant">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="truncate">{node.label}</span>
            </div>
          )) : <p className="text-xs text-on-surface-variant">No nodes.</p>}
        </div>
        <div className="min-h-0 overflow-auto rounded-xl border border-outline-variant/45 bg-surface-container-lowest p-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Connections</h3>
          {normalized.connections.length ? normalized.connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              onClick={() => removeConnection(connection.id)}
              onMouseEnter={() => setHoveredConnectionId(connection.id)}
              onMouseLeave={() => setHoveredConnectionId(null)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-on-surface-variant transition-colors hover:bg-error-container/25 hover:text-error"
            >
              <span className="truncate">{nodeById.get(connection.from_node_id)?.label ?? connection.from_node_id}</span>
              <ArrowRight size={12} className="shrink-0" />
              <span className="truncate">{nodeById.get(connection.to_node_id)?.label ?? connection.to_node_id}</span>
            </button>
          )) : <p className="text-xs text-on-surface-variant">No connections.</p>}
        </div>
      </div>
    </div>
  );
}
