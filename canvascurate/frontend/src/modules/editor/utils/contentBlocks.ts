import { escapeAttribute, escapeHtml } from "./html";

export type ManagedImageInsertMode = "image" | "imageText" | "imageCard" | "profileCard" | "fullWidthImage" | "testimonial";
export type ManagedContentBlockMode = "moduleHeader" | "pullQuote" | "stepIndicator";

export function managedImageBlockLabel(mode: ManagedImageInsertMode) {
  if (mode === "imageText") return "Image + Text";
  if (mode === "imageCard") return "Image Card";
  if (mode === "profileCard") return "Profile Card";
  if (mode === "fullWidthImage") return "Full Width Image";
  if (mode === "testimonial") return "Testimonial";
  return "image";
}

function buildManagedImageAttrs({
  alt,
  canvasFileId,
  decorative,
  src,
  style,
  title,
}: {
  alt: string;
  canvasFileId: string | null;
  decorative: boolean;
  src: string;
  style: string;
  title: string;
}) {
  return [
    `src="${escapeAttribute(src)}"`,
    `alt="${decorative ? "" : escapeAttribute(alt)}"`,
    title ? `title="${escapeAttribute(title)}"` : "",
    canvasFileId ? `data-canvas-file-id="${escapeAttribute(canvasFileId)}"` : "",
    decorative ? 'role="presentation"' : "",
    decorative ? 'data-decorative="true"' : "",
    `style="${escapeAttribute(style)}"`,
  ].filter(Boolean).join(" ");
}

export function buildManagedImageBlockHtml({
  alt,
  canvasFileId,
  decorative,
  mode,
  src,
  title,
}: {
  alt: string;
  canvasFileId: string | null;
  decorative: boolean;
  mode: ManagedImageInsertMode;
  src: string;
  title: string;
}) {
  if (mode === "imageCard") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:100%;height:200px;object-fit:cover;",
    });
    return `<div style="border:1px solid #e0e0e0;border-radius:12px;overflow:hidden;margin:16px 0;max-width:360px;"><img ${imgAttrs} /><div data-html-block-editable="true" style="padding:16px;"><p style="font-weight:600;margin:0;">Card Title</p><p style="margin:8px 0 0;color:#555;font-size:14px;">Card description text.</p></div></div>`;
  }
  if (mode === "profileCard") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:80px;height:80px;border-radius:50%;object-fit:cover;flex-shrink:0;",
    });
    return `<div style="display:flex;gap:16px;align-items:center;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="min-width:220px;flex:1;"><p style="font-weight:600;margin:0;">Full Name</p><p style="color:#8C1D40;font-size:14px;margin:4px 0;">Role / Title</p><p style="color:#555;font-size:14px;margin:0;">Short bio.</p></div></div>`;
  }
  if (mode === "fullWidthImage") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:100%;border-radius:8px;",
    });
    return `<figure style="margin:16px 0;"><img ${imgAttrs} /><figcaption data-html-block-editable="true" style="text-align:center;font-size:13px;color:#666;margin-top:8px;">Image caption goes here</figcaption></figure>`;
  }
  if (mode === "testimonial") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;",
    });
    return `<div style="display:flex;gap:16px;align-items:flex-start;background:#f8f5ef;border-radius:12px;padding:20px;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="min-width:220px;flex:1;"><p style="font-style:italic;margin:0;line-height:1.5;">"Replace this with the testimonial text."</p><p style="font-weight:600;margin:8px 0 0;color:#8C1D40;">- Name, Title</p></div></div>`;
  }

  const imgAttrs = buildManagedImageAttrs({
    alt,
    canvasFileId,
    decorative,
    src,
    title,
    style: "width:40%;min-width:220px;border-radius:8px;object-fit:cover;align-self:stretch;max-height:320px;",
  });
  return `<div style="display:flex;gap:20px;align-items:flex-start;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="flex:1;min-width:240px;"><p style="font-weight:600;margin:0;">Title Here</p><p style="margin:8px 0 0;">Description text goes here.</p></div></div>`;
}

export function buildManagedContentBlockHtml(mode: ManagedContentBlockMode) {
  if (mode === "moduleHeader") {
    return `<div data-html-block-editable="true" style="background:linear-gradient(to right,#8C1D40,#5C0F2D);color:#fff;padding:24px 28px;border-radius:10px;margin:16px 0;"><p style="font-size:.85em;text-transform:uppercase;letter-spacing:1px;margin:0;opacity:.85;">Module 1</p><p style="font-size:1.6em;font-weight:700;margin:6px 0 0;">Module Title Here</p><p style="margin:8px 0 0;opacity:.9;font-size:.95em;">Brief module description.</p></div>`;
  }
  if (mode === "pullQuote") {
    return `<div data-html-block-editable="true" style="text-align:center;margin:32px 0;padding:20px;"><p style="font-size:1.5em;font-style:italic;color:#333;line-height:1.5;margin:0;">"Replace this with a meaningful quote."</p><p style="color:#8C1D40;font-weight:600;margin:12px 0 0;">- Attribution Name</p></div>`;
  }
  if (mode === "stepIndicator") {
    return `<div style="display:flex;gap:0;align-items:flex-start;margin:16px 0;flex-wrap:wrap;"><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#8C1D40;color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">1</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step One</p></div><div style="flex:0 0 40px;height:2px;background:#8C1D40;margin-top:20px;"></div><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#FFC627;color:#1a1a1a;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">2</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step Two</p></div><div style="flex:0 0 40px;height:2px;background:#ddd;margin-top:20px;"></div><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#e0e0e0;color:#666;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">3</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step Three</p></div></div>`;
  }
  return "";
}

export function buildColumnLayoutHtml(columns: 2 | 3) {
  const columnWidth = columns === 2 ? "50%" : "33.3333%";
  const cells = Array.from({ length: columns }, (_, index) => (
    `<td style="width:${columnWidth};border:none;padding:${columns === 2 ? "16px" : "12px"};vertical-align:top;background:#f9f9f9;"><p>Column ${index + 1}${columns === 2 ? " content" : ""}</p></td>`
  )).join("");
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:${columns === 2 ? "24px" : "16px"};margin:16px 0;"><tbody><tr>${cells}</tr></tbody></table>`;
}

export function buildCtaButtonHtml(url: string, label: string) {
  return `<div style="text-align:center;margin:24px 0;"><a data-html-block-editable="true" href="${escapeAttribute(url)}" style="display:inline-block;padding:14px 32px;background:#8C1D40;color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;box-shadow:0 2px 8px rgba(140,29,64,0.3);">${escapeHtml(label)}</a></div>`;
}

export function normalizeCtaUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return "";
  if (/^(#|\/|[a-z][a-z0-9+.-]*:)/i.test(trimmedUrl)) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

export function parseVideoEmbedUrl(url: string) {
  const trimmed = url.trim();
  let match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match) return { provider: "YouTube", embedUrl: `https://www.youtube.com/embed/${match[1]}` };
  match = trimmed.match(/vimeo\.com\/(\d+)/);
  if (match) return { provider: "Vimeo", embedUrl: `https://player.vimeo.com/video/${match[1]}` };
  if (/^https?:\/\//i.test(trimmed)) return { provider: "URL", embedUrl: trimmed };
  return null;
}

export function buildVideoEmbedHtml(embedUrl: string) {
  return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:16px 0;border-radius:8px;"><iframe src="${escapeAttribute(embedUrl)}" title="Embedded video" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
}

const LATEX_DISPLAY_REPLACEMENTS: Record<string, string> = {
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\theta": "θ",
  "\\lambda": "λ",
  "\\pi": "π",
  "\\sigma": "σ",
  "\\omega": "ω",
  "\\Delta": "Δ",
  "\\Sigma": "Σ",
  "\\Omega": "Ω",
  "\\pm": "±",
  "\\times": "×",
  "\\div": "÷",
  "\\cdot": "⋅",
  "\\le": "≤",
  "\\ge": "≥",
  "\\ne": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\propto": "∝",
  "\\infty": "∞",
  "\\angle": "∠",
  "\\int": "∫",
  "\\iint": "∬",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\in": "∈",
  "\\notin": "∉",
  "\\subseteq": "⊆",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\emptyset": "∅",
  "\\to": "→",
};

export function renderLatexDisplay(latex: string) {
  let display = ` ${escapeHtml(latex.trim())} `;
  display = display.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.05;margin:0 3px;"><span>$1</span><span style="border-top:1px solid currentColor;padding:1px 3px 0;">$2</span></span>');
  display = display.replace(/\\sqrt\{([^{}]*)\}/g, '√<span style="border-top:1px solid currentColor;padding:0 2px;">$1</span>');
  display = display.replace(/\^\{([^{}]*)\}/g, "<sup>$1</sup>");
  display = display.replace(/_\{([^{}]*)\}/g, "<sub>$1</sub>");
  display = display.replace(/\\lim/g, "lim");
  Object.entries(LATEX_DISPLAY_REPLACEMENTS)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([source, replacement]) => {
      display = display.replaceAll(source, replacement);
    });
  display = display
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\,", " ")
    .replaceAll("\\;", " ")
    .replaceAll("\\", "");
  return display.trim() || escapeHtml(latex.trim());
}

export function buildLatexHtml(latex: string, displayMode: boolean) {
  const source = latex.trim();
  const rendered = renderLatexDisplay(source);
  return `<div data-latex-block="true" data-latex-source="${escapeAttribute(source)}" data-latex-display-mode="${displayMode ? "display" : "inline"}" style="margin:16px 0;padding:14px 16px;border:1px solid #ddbfc3;border-radius:8px;background:#fff;"><p style="margin:0;font-family:Georgia,serif;font-size:${displayMode ? "1.35em" : "1.05em"};text-align:${displayMode ? "center" : "left"};">${rendered}</p></div>`;
}
