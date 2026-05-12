/**
 * Shared TagFlow frontend data types.
 *
 * Defines portable structures used by document detail views, TagFlow editing,
 * and future focused remediation components.
 */

export type FlowchartNode = {
  id: string;
  label: string;
  description?: string | null;
  reading_order: number;
  role?: "start" | "end" | "intermediate" | "independent" | null;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type FlowchartConnection = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  label?: string | null;
  description?: string | null;
  order: number;
  from_anchor?: { x: number; y: number } | null;
  to_anchor?: { x: number; y: number } | null;
};

export type FlowchartStructure = {
  nodes: FlowchartNode[];
  connections: FlowchartConnection[];
  reading_order?: string[];
  guidance?: string | null;
};
