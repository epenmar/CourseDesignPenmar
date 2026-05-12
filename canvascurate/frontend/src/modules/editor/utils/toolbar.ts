import type { Editor } from "@tiptap/react";

import { escapeAttribute, escapeHtml } from "@/modules/editor/utils/html";

/**
 * Shared editor toolbar helpers for inline styling, block indentation, and
 * reusable inserted toolbar markup.
 */

export function buildStyledTableHtml() {
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;"><thead><tr><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 1</th><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 2</th><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 3</th></tr></thead><tbody><tr style="background:#fff;"><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 1</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 2</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 3</td></tr><tr style="background:#f8f5ef;"><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 4</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 5</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 6</td></tr></tbody></table>`;
}

export function styleValue(style: unknown, property: string) {
  if (typeof style !== "string") return "";
  const match = style
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${property.toLowerCase()}:`));
  return match?.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "") ?? "";
}

export function updateInlineStyle(editor: Editor | null, property: string, value: string) {
  if (!editor) return;
  const currentStyle = String(editor.getAttributes("spanStyle").style ?? "");
  const nextStyle = updateStyleDeclaration(currentStyle, property, value);
  if (nextStyle) editor.chain().focus().setMark("spanStyle", { style: nextStyle }).run();
  else editor.chain().focus().unsetMark("spanStyle").run();
}

export function updateBlockIndent(editor: Editor | null, direction: 1 | -1) {
  if (!editor) return;
  if (editor.isActive("listItem")) {
    const command = direction > 0
      ? editor.chain().focus().sinkListItem("listItem")
      : editor.chain().focus().liftListItem("listItem");
    if (command.run()) return;
  }

  const blockType = editor.isActive("heading") ? "heading" : "paragraph";
  const currentStyle = String(editor.getAttributes(blockType).style ?? "");
  const nextLevel = Math.max(0, Math.min(8, blockIndentLevel(currentStyle) + direction));
  const nextStyle = updateStyleDeclaration(currentStyle, "margin-left", nextLevel ? `${nextLevel * 24}px` : "");
  editor.chain().focus().updateAttributes(blockType, { style: nextStyle || null }).run();
}

export function applyPillStyle(editor: Editor | null, color: string) {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const selectedText = editor.state.doc.textBetween(from, to);
  if (!selectedText.trim()) return;
  const foreground = color === "#ffc627" || color === "#775a00" ? "#ffffff" : "#ffffff";
  const style = [
    `background-color:${color}`,
    `color:${foreground}`,
    "padding:2px 10px",
    "border-radius:12px",
    "font-weight:700",
    "font-size:11px",
    "display:inline-block",
    "line-height:1.6",
    "vertical-align:middle",
    "margin-right:4px",
    "letter-spacing:0.5px",
    "text-transform:uppercase",
  ].join(";");
  editor.chain().focus().deleteSelection().insertContent(`<span style="${escapeAttribute(style)}">${escapeHtml(selectedText)}</span>`).run();
}

function updateStyleDeclaration(style: string, property: string, value: string) {
  const styles = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith(`${property.toLowerCase()}:`));
  if (value) styles.push(`${property}: ${value}`);
  return styles.join("; ");
}

function blockIndentLevel(style: string) {
  const raw = styleValue(style, "margin-left");
  const match = raw.match(/^(\d+(?:\.\d+)?)(px|rem|em)?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2] || "px";
  if (unit === "rem" || unit === "em") return Math.round(amount / 1.5);
  return Math.round(amount / 24);
}
