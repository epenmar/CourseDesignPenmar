"""Reference-informed PDF structure writer.

Creates the first structure-tree export from the TagFlow structure plan. This
adds document metadata, /Lang, /MarkInfo, and a PDF role tree; marked-content
MCID binding remains the next writer slice before claiming full PDF/UA output.
"""

from __future__ import annotations

import io
from typing import Any


def _load_pikepdf():
    try:
        import pikepdf  # type: ignore
    except ImportError as exc:
        raise RuntimeError("pikepdf is required for PDF structure-tree export generation") from exc
    return pikepdf


def _pdf_string(value: Any, limit: int = 1200) -> str:
    return " ".join(str(value or "").split())[:limit].rstrip()


def _node_sort_key(node: dict[str, Any]) -> tuple[int, str]:
    try:
        order = int(node.get("reading_order") or 0)
    except (TypeError, ValueError):
        order = 0
    return order, str(node.get("id") or "")


def _structure_kids(value: Any, pikepdf_module: Any | None = None) -> list[Any]:
    if value is None:
        return []
    if pikepdf_module is not None:
        if isinstance(value, pikepdf_module.Array):
            return list(value)
        if isinstance(value, pikepdf_module.Dictionary):
            return [value]
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, dict) or isinstance(value, (str, bytes)):
        return [value]
    try:
        return list(value)
    except TypeError:
        pass
    return [value]


def _name_value(value: Any) -> str:
    return str(value or "").lstrip("/")


def _walk_structure_roles(element: Any, role_counts: dict[str, int], alt_count: list[int], pikepdf_module: Any) -> None:
    try:
        role = _name_value(element.get("/S"))
    except Exception:
        role = ""
    if role:
        role_counts[role] = role_counts.get(role, 0) + 1
    try:
        if element.get("/Alt"):
            alt_count[0] += 1
    except Exception:
        pass
    try:
        kids = _structure_kids(element.get("/K"), pikepdf_module)
    except Exception:
        kids = []
    for kid in kids:
        if hasattr(kid, "get"):
            _walk_structure_roles(kid, role_counts, alt_count, pikepdf_module)


def inspect_pdf_structure(pdf_bytes: bytes, *, expected_structure_plan: dict[str, Any]) -> dict[str, Any]:
    """Inspect generated PDF structure signals for export artifact metadata."""
    pikepdf = _load_pikepdf()
    expected_roles = expected_structure_plan.get("role_counts") if isinstance(expected_structure_plan.get("role_counts"), dict) else {}
    expected_roles = {str(role): int(count or 0) for role, count in expected_roles.items()}

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        root = pdf.Root
        mark_info = root.get("/MarkInfo")
        marked = bool(mark_info and mark_info.get("/Marked"))
        language = _pdf_string(root.get("/Lang"), limit=80)
        struct_tree = root.get("/StructTreeRoot")
        has_struct_tree = bool(struct_tree)
        role_counts: dict[str, int] = {}
        alt_count = [0]
        if struct_tree:
            for kid in _structure_kids(struct_tree.get("/K"), pikepdf):
                if hasattr(kid, "get"):
                    _walk_structure_roles(kid, role_counts, alt_count, pikepdf)

    missing_expected_roles = [
        role
        for role, expected_count in sorted(expected_roles.items())
        if expected_count > 0 and role_counts.get(role, 0) < expected_count
    ]
    checks = {
        "lang": "passed" if language else "failed",
        "mark_info": "passed" if marked else "failed",
        "struct_tree": "passed" if has_struct_tree else "failed",
        "role_counts": "passed" if not missing_expected_roles else "warning",
    }
    return {
        "kind": "pdf_export_artifact_inspection",
        "status": "passed" if all(value == "passed" for value in checks.values()) else "review",
        "checks": checks,
        "language": language,
        "marked": marked,
        "has_struct_tree": has_struct_tree,
        "role_counts": role_counts,
        "expected_role_counts": expected_roles,
        "missing_expected_roles": missing_expected_roles,
        "alt_count": alt_count[0],
    }


def write_planned_structure_pdf(
    source_pdf: bytes,
    *,
    export_document: dict[str, Any],
    structure_plan: dict[str, Any],
) -> bytes:
    """Write metadata and a planned structure tree into a PDF."""
    pikepdf = _load_pikepdf()
    metadata = export_document.get("metadata") if isinstance(export_document.get("metadata"), dict) else {}
    title = _pdf_string(metadata.get("title"), limit=300)
    language = _pdf_string(metadata.get("language"), limit=80)

    input_buffer = io.BytesIO(source_pdf)
    output_buffer = io.BytesIO()
    with pikepdf.open(input_buffer) as pdf:
        with pdf.open_metadata(set_pikepdf_as_editor=False) as xmp:
            if title:
                xmp["dc:title"] = title
            if language:
                xmp["dc:language"] = [language]

        if language:
            pdf.Root["/Lang"] = language
        mark_info = pdf.Root.get("/MarkInfo")
        if not isinstance(mark_info, pikepdf.Dictionary):
            mark_info = pikepdf.Dictionary()
        mark_info["/Marked"] = True
        pdf.Root["/MarkInfo"] = mark_info

        struct_tree = pikepdf.Dictionary({
            "/Type": pikepdf.Name("/StructTreeRoot"),
            "/K": pikepdf.Array(),
            "/ParentTree": pikepdf.Dictionary({
                "/Type": pikepdf.Name("/ParentTree"),
                "/Nums": pikepdf.Array(),
            }),
        })
        struct_tree_ref = pdf.make_indirect(struct_tree)
        document_elem = pikepdf.Dictionary({
            "/Type": pikepdf.Name("/StructElem"),
            "/S": pikepdf.Name("/Document"),
            "/P": struct_tree_ref,
            "/K": pikepdf.Array(),
        })
        document_elem_ref = pdf.make_indirect(document_elem)
        struct_tree["/K"].append(document_elem_ref)

        for page in structure_plan.get("pages") or []:
            if not isinstance(page, dict):
                continue
            nodes = [node for node in page.get("nodes") or [] if isinstance(node, dict)]
            if not nodes:
                continue
            section_elem = pikepdf.Dictionary({
                "/Type": pikepdf.Name("/StructElem"),
                "/S": pikepdf.Name("/Sect"),
                "/P": document_elem_ref,
                "/K": pikepdf.Array(),
            })
            section_elem_ref = pdf.make_indirect(section_elem)
            for node in sorted(nodes, key=_node_sort_key):
                pdf_role = _pdf_string(node.get("pdf_role"), limit=40)
                if not pdf_role:
                    continue
                zone_elem = pikepdf.Dictionary({
                    "/Type": pikepdf.Name("/StructElem"),
                    "/S": pikepdf.Name(f"/{pdf_role}"),
                    "/P": section_elem_ref,
                })
                alt_text = _pdf_string(node.get("alt_text"), limit=1200)
                long_description = _pdf_string(node.get("long_description"), limit=1200)
                actual_text = _pdf_string(node.get("actual_text") or node.get("text"), limit=1200)
                if pdf_role == "Figure" and alt_text:
                    zone_elem["/Alt"] = alt_text
                if long_description:
                    zone_elem["/ActualText"] = long_description
                elif actual_text:
                    zone_elem["/ActualText"] = actual_text
                section_elem["/K"].append(pdf.make_indirect(zone_elem))
            if section_elem["/K"]:
                document_elem["/K"].append(section_elem_ref)

        pdf.Root["/StructTreeRoot"] = struct_tree_ref
        pdf.save(output_buffer)

    return output_buffer.getvalue()
