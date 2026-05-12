/**
 * Preview document helpers for editor iframe rendering.
 */

import { escapeAttribute, escapeHtml } from "@/modules/editor/utils/html";

export function previewDocument(htmlBody: string, plainText: string, baseHref: string) {
  const baseTag = baseHref ? `<base href="${escapeAttribute(baseHref)}" target="_blank">` : "";
  const body = htmlBody || `<pre>${escapeHtml(plainText || "No saved body content was found for this item.")}</pre>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseTag}
  <style>
    :root { color: #0b1c30; background: #ffffff; font-family: Inter, Arial, sans-serif; }
    body { margin: 0; padding: 28px; line-height: 1.55; font-size: 15px; }
    h1, h2, h3, h4, h5, h6 { font-family: Manrope, Arial, sans-serif; line-height: 1.2; margin: 1.2em 0 0.45em; }
    h1 { font-size: 1.8rem; } h2 { font-size: 1.45rem; } h3 { font-size: 1.2rem; }
    p, ul, ol, table, blockquote, pre { margin: 0.75rem 0; }
    blockquote { border-left: 4px solid #8c1d40; margin-left: 0; padding: 0.25rem 0 0.25rem 1rem; color: #564145; background: #eff4ff; }
    a { color: #8c1d40; text-decoration: underline; overflow-wrap: anywhere; }
    img, video, iframe, embed, object { max-width: 100%; }
    img { height: auto; }
    iframe { width: 100%; min-height: 320px; border: 1px solid #ddbfc3; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddbfc3; padding: 0.5rem; vertical-align: top; }
    th { background: #eff4ff; text-align: left; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #eff4ff; padding: 1rem; border-radius: 8px; }
    .callout-box { border-radius: 8px; padding: 12px 16px; margin: 16px 0; border-left: 4px solid #94a3b8; background: #f8fafc; }
    .callout-box[data-callout-type="info"] { border-left-color: #3b82f6; background: #eff6ff; }
    .callout-box[data-callout-type="warning"] { border-left-color: #f59e0b; background: #fffbeb; }
    .callout-box[data-callout-type="tip"] { border-left-color: #10b981; background: #ecfdf5; }
    .callout-box[data-callout-type="note"] { border-left-color: #8b5cf6; background: #f5f3ff; }
    details.accordion-block, details:not([style*="border"]) { border: 1px solid #ddbfc3; border-radius: 8px; overflow: hidden; background: #fff; }
    details > summary { cursor: pointer; padding: 12px 16px; font-weight: 700; background: #eff4ff; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: "▸"; display: inline-block; margin-right: 8px; color: #8c1d40; }
    details[open] > summary::before { transform: rotate(90deg); }
    details .accordion-content, details > :not(summary) { padding: 12px 16px; }
    .separator-thin { border: none; border-top: 1px solid #cbd5e1; }
    .separator-thick { border: none; border-top: 4px solid #cbd5e1; }
    .separator-dashed { border: none; border-top: 2px dashed #cbd5e1; }
    .separator-dotted { border: none; border-top: 2px dotted #cbd5e1; }
    .separator-double { border: none; border-top: 4px double #cbd5e1; }
    .separator-gradient { height: 4px; border: none; background: linear-gradient(90deg, #8c1d40, #ffc627); }
  </style>
</head>
<body>${body}</body>
</html>`;
}
