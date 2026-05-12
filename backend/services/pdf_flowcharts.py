"""Flowchart and diagram metadata helpers for PDF figure remediation.

Normalizes figure type, freeform guidance, and structured flowchart node /
connection data that later AI text generation and tagged-PDF export can reuse.
"""

from __future__ import annotations

from typing import Any, Literal


FigureType = Literal["image", "diagram", "flowchart"]
ALLOWED_FIGURE_TYPES = {"image", "diagram", "flowchart"}
FLOWCHART_STRUCTURE_VERSION = 1
FLOWCHART_NODE_ROLES = {"start", "end", "intermediate", "independent"}


def normalize_figure_type(value: Any) -> FigureType:
    figure_type = str(value or "image").strip().lower()
    if figure_type in ALLOWED_FIGURE_TYPES:
        return figure_type  # type: ignore[return-value]
    return "image"


def compact_flowchart_guidance(value: Any, max_length: int = 4000) -> str:
    lines = [" ".join(str(line).split()) for line in str(value or "").splitlines()]
    return "\n".join(line for line in lines if line)[:max_length]


def _compact_inline(value: Any, max_length: int) -> str:
    return " ".join(str(value or "").split())[:max_length]


def _bounded_float(value: Any, *, minimum: float, maximum: float, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = fallback
    return round(max(minimum, min(maximum, numeric)), 3)


def _normalize_bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    x = _bounded_float(value.get("x"), minimum=0, maximum=100, fallback=0)
    y = _bounded_float(value.get("y"), minimum=0, maximum=100, fallback=0)
    width = _bounded_float(value.get("width"), minimum=1, maximum=100 - x, fallback=16)
    height = _bounded_float(value.get("height"), minimum=1, maximum=100 - y, fallback=8)
    return {"x": x, "y": y, "width": width, "height": height}


def _normalize_point(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    return {
        "x": _bounded_float(value.get("x"), minimum=0, maximum=100, fallback=50),
        "y": _bounded_float(value.get("y"), minimum=0, maximum=100, fallback=50),
    }


def normalize_flowchart_structure(payload: Any, *, updated_at: str | None = None) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    raw_nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
    raw_connections = data.get("connections") if isinstance(data.get("connections"), list) else []
    raw_reading_order = data.get("reading_order") if isinstance(data.get("reading_order"), list) else []

    nodes: list[dict[str, Any]] = []
    seen_node_ids: set[str] = set()
    for index, node in enumerate(raw_nodes[:300], start=1):
        if not isinstance(node, dict):
            continue
        label = _compact_inline(node.get("label"), 200)
        if not label:
            continue
        node_id = _compact_inline(node.get("id"), 80) or f"node-{index}"
        if node_id in seen_node_ids:
            node_id = f"{node_id}-{index}"
        seen_node_ids.add(node_id)
        try:
            reading_order = max(1, min(300, int(node.get("reading_order") or index)))
        except (TypeError, ValueError):
            reading_order = index
        role = _compact_inline(node.get("role"), 40)
        nodes.append({
            "id": node_id,
            "label": label,
            "description": _compact_inline(node.get("description"), 1000),
            "reading_order": reading_order,
            "role": role if role in FLOWCHART_NODE_ROLES else "intermediate",
            "bounds": _normalize_bounds(node.get("bounds")),
        })

    node_ids = {node["id"] for node in nodes}
    connections: list[dict[str, Any]] = []
    for index, connection in enumerate(raw_connections[:500], start=1):
        if not isinstance(connection, dict):
            continue
        from_node_id = _compact_inline(connection.get("from_node_id"), 80)
        to_node_id = _compact_inline(connection.get("to_node_id"), 80)
        if from_node_id not in node_ids or to_node_id not in node_ids:
            continue
        try:
            order = max(1, min(500, int(connection.get("order") or index)))
        except (TypeError, ValueError):
            order = index
        connections.append({
            "id": _compact_inline(connection.get("id"), 80) or f"connection-{index}",
            "from_node_id": from_node_id,
            "to_node_id": to_node_id,
            "label": _compact_inline(connection.get("label"), 200),
            "description": _compact_inline(connection.get("description"), 1000),
            "order": order,
            "from_anchor": _normalize_point(connection.get("from_anchor")),
            "to_anchor": _normalize_point(connection.get("to_anchor")),
        })

    reading_order = [
        node_id
        for node_id in (_compact_inline(item, 80) for item in raw_reading_order)
        if node_id in node_ids
    ]
    for node in sorted(nodes, key=lambda item: int(item.get("reading_order") or 0)):
        if node["id"] not in reading_order:
            reading_order.append(node["id"])

    return {
        "kind": "pdf_flowchart_structure",
        "version": FLOWCHART_STRUCTURE_VERSION,
        "nodes": nodes,
        "connections": sorted(connections, key=lambda item: int(item.get("order") or 0)),
        "reading_order": reading_order,
        "guidance": compact_flowchart_guidance(data.get("guidance")),
        "updated_at": updated_at,
    }


def flowchart_structure_guidance(flowchart: Any) -> str:
    data = flowchart if isinstance(flowchart, dict) else {}
    nodes = [node for node in data.get("nodes") or [] if isinstance(node, dict)]
    connections = [connection for connection in data.get("connections") or [] if isinstance(connection, dict)]
    lines: list[str] = []
    guidance = compact_flowchart_guidance(data.get("guidance"))
    if guidance:
        lines.append(guidance)
    if nodes:
        node_by_id = {str(node.get("id")): node for node in nodes if node.get("id")}
        ordered_node_ids = [
            str(node_id)
            for node_id in data.get("reading_order") or []
            if str(node_id) in node_by_id
        ]
        for node in sorted(nodes, key=lambda item: int(item.get("reading_order") or 0)):
            node_id = str(node.get("id") or "")
            if node_id and node_id not in ordered_node_ids:
                ordered_node_ids.append(node_id)
        lines.append("Flowchart nodes in reading order:")
        for index, node_id in enumerate(ordered_node_ids, start=1):
            node = node_by_id.get(node_id) or {}
            label = _compact_inline(node.get("label"), 200)
            description = _compact_inline(node.get("description"), 1000)
            lines.append(f"{index}. {label}{f' - {description}' if description else ''}")
    if connections:
        node_labels = {str(node.get("id")): _compact_inline(node.get("label"), 200) for node in nodes}
        lines.append("Flowchart connections:")
        for connection in sorted(connections, key=lambda item: int(item.get("order") or 0)):
            source = node_labels.get(str(connection.get("from_node_id"))) or str(connection.get("from_node_id") or "")
            target = node_labels.get(str(connection.get("to_node_id"))) or str(connection.get("to_node_id") or "")
            label = _compact_inline(connection.get("label"), 200)
            description = _compact_inline(connection.get("description"), 1000)
            relation = f"{source} -> {target}"
            if label:
                relation += f" ({label})"
            if description:
                relation += f": {description}"
            lines.append(relation)
    return compact_flowchart_guidance("\n".join(lines), 4000)


def build_figure_generation_context(
    *,
    document_name: str,
    figure: dict[str, Any],
    figure_type: Any = None,
    guidance: Any = None,
) -> str:
    normalized_type = normalize_figure_type(figure_type or figure.get("figure_type"))
    structured_guidance = flowchart_structure_guidance(figure.get("flowchart"))
    requested_guidance = compact_flowchart_guidance(guidance or figure.get("flowchart_guidance"))
    compact_guidance = compact_flowchart_guidance("\n".join(
        item for item in [requested_guidance, structured_guidance] if item
    ))
    page_number = figure.get("page_number") or "unknown"
    context = [
        f"PDF {normalized_type} from document {document_name} on page {page_number}.",
        "Generate accessibility text for this isolated crop.",
    ]
    if normalized_type in {"diagram", "flowchart"}:
        context.append(
            "This crop may contain connected shapes, labels, arrows, or a process flow. "
            "Prioritize the meaningful relationships over decorative styling."
        )
    if compact_guidance:
        context.append(
            "User-provided figure guidance follows. Treat it as authoritative for the flow, "
            "node order, relationships, and exact labels when it conflicts with visual inference."
        )
        context.append(compact_guidance)
    return "\n".join(context)
