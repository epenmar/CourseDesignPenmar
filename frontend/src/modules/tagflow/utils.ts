/**
 * Shared TagFlow frontend helpers.
 *
 * Normalizes user-authored remediation structures before display, generation,
 * or API persistence.
 */

import type { FlowchartStructure } from "./types";

type FlowchartNodeRole = NonNullable<FlowchartStructure["nodes"][number]["role"]>;

function clampPercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function normalizeBounds(value: FlowchartStructure["nodes"][number]["bounds"] | undefined | null) {
  if (!value) return null;
  const x = clampPercent(value.x, 0);
  const y = clampPercent(value.y, 0);
  return {
    x,
    y,
    width: Math.max(2, Math.min(100 - x, clampPercent(value.width, 16))),
    height: Math.max(2, Math.min(100 - y, clampPercent(value.height, 8))),
  };
}

function normalizeAnchor(value: FlowchartStructure["connections"][number]["from_anchor"] | undefined | null) {
  if (!value) return null;
  return {
    x: clampPercent(value.x, 50),
    y: clampPercent(value.y, 50),
  };
}

function normalizeRole(value: unknown): FlowchartNodeRole {
  return value === "start" || value === "end" || value === "independent" ? value : "intermediate";
}

export function normalizeFlowchartStructure(
  value: FlowchartStructure | null | undefined,
  fallbackGuidance = ""
): FlowchartStructure {
  const nodes = (value?.nodes ?? [])
    .filter((node) => node.label?.trim())
    .map((node, index) => ({
      id: node.id || `node-${index + 1}`,
      label: node.label ?? "",
      description: node.description ?? "",
      reading_order: Number(node.reading_order || index + 1),
      role: normalizeRole(node.role),
      bounds: normalizeBounds(node.bounds),
    }))
    .sort((first, second) => first.reading_order - second.reading_order);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = (value?.connections ?? [])
    .filter((connection) => nodeIds.has(connection.from_node_id) && nodeIds.has(connection.to_node_id))
    .map((connection, index) => ({
      id: connection.id || `connection-${index + 1}`,
      from_node_id: connection.from_node_id,
      to_node_id: connection.to_node_id,
      label: connection.label ?? "",
      description: connection.description ?? "",
      order: Number(connection.order || index + 1),
      from_anchor: normalizeAnchor(connection.from_anchor),
      to_anchor: normalizeAnchor(connection.to_anchor),
    }))
    .sort((first, second) => first.order - second.order);
  const readingOrder = (value?.reading_order ?? []).filter((nodeId) => nodeIds.has(nodeId));
  nodes.forEach((node) => {
    if (!readingOrder.includes(node.id)) readingOrder.push(node.id);
  });
  return {
    nodes,
    connections,
    reading_order: readingOrder,
    guidance: value?.guidance ?? fallbackGuidance,
  };
}

export function emptyFlowchartStructure(guidance = ""): FlowchartStructure {
  return { nodes: [], connections: [], reading_order: [], guidance };
}

export function flowchartGuidanceFromStructure(
  structure: FlowchartStructure | null | undefined,
  fallbackGuidance = ""
) {
  const normalized = normalizeFlowchartStructure(structure, fallbackGuidance);
  const lines = [fallbackGuidance];
  if (normalized.nodes.length) {
    lines.push("Nodes:");
    normalized.nodes.forEach((node) => {
      lines.push(`${node.reading_order}. ${node.label}${node.description ? ` - ${node.description}` : ""}`);
    });
  }
  if (normalized.connections.length) {
    const labels = new Map(normalized.nodes.map((node) => [node.id, node.label]));
    lines.push("Connections:");
    normalized.connections.forEach((connection) => {
      lines.push(`${labels.get(connection.from_node_id) ?? connection.from_node_id} -> ${labels.get(connection.to_node_id) ?? connection.to_node_id}${connection.label ? ` (${connection.label})` : ""}${connection.description ? `: ${connection.description}` : ""}`);
    });
  }
  const startNodes = normalized.nodes.filter((node) => node.role === "start").map((node) => node.label);
  const independentNodes = normalized.nodes.filter((node) => node.role === "independent").map((node) => node.label);
  const endNodes = normalized.nodes.filter((node) => node.role === "end").map((node) => node.label);
  if (startNodes.length) lines.push(`Begin from: ${startNodes.join(", ")}`);
  if (independentNodes.length) lines.push(`Independent nodes: ${independentNodes.join(", ")}`);
  if (endNodes.length) lines.push(`End at: ${endNodes.join(", ")}`);
  return lines.filter((line) => line.trim()).join("\n").slice(0, 4000);
}
