export type AccessibilityIssue = {
  id: string;
  severity: "error" | "warning";
  rule: string;
  code: "img-alt" | "filename-alt" | "empty-heading" | "heading-skip" | "empty-link" | "vague-link" | "file-link" | "table-header" | "color-contrast";
  message: string;
  fix: string;
  context?: string;
  index?: number;
  previousLevel?: number;
  currentLevel?: number;
  text?: string;
  href?: string;
};

function parseCssColor(raw: string): [number, number, number] | null {
  const value = raw.trim().toLowerCase();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split("").map((char) => `${char}${char}`).join("");
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = value.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    return [
      Number.parseInt(rgbMatch[1], 10),
      Number.parseInt(rgbMatch[2], 10),
      Number.parseInt(rgbMatch[3], 10),
    ];
  }
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    red: [255, 0, 0],
    orange: [255, 165, 0],
    yellow: [255, 255, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    purple: [128, 0, 128],
  };
  return named[value] ?? null;
}

function relativeLuminance([r, g, b]: [number, number, number]) {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function colorContrastRatio(foreground: [number, number, number], background: [number, number, number]) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function styleProperty(style: string, property: string) {
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function normalizedUrlText(value: string) {
  return value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function linkTextLooksLikeUrl(text: string, href: string) {
  const normalizedText = normalizedUrlText(text);
  const normalizedHref = normalizedUrlText(href);
  return (
    /^https?:\/\//i.test(text.trim())
    || /^www\./i.test(text.trim())
    || (normalizedHref && normalizedText === normalizedHref)
  );
}

function textLooksLikeFileName(text: string) {
  return /^[^/\\]+\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(text.trim());
}

function linkLooksLikeCanvasFile(anchor: HTMLAnchorElement, href: string) {
  return (
    anchor.getAttribute("data-api-returntype")?.toLowerCase() === "file"
    || /\/files\/\d+(?:\/|$|\?)/i.test(href)
  );
}

export function runAccessibilityChecks(htmlBody: string): AccessibilityIssue[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");
  const issues: AccessibilityIssue[] = [];

  doc.body.querySelectorAll("img").forEach((img, index) => {
    const alt = img.getAttribute("alt");
    const decorative = img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true" || img.getAttribute("data-decorative") === "true";
    if (decorative) return;
    if (alt === null) {
      issues.push({
        id: `img-alt-${index}`,
        severity: "error",
        rule: "Image alt text",
        code: "img-alt",
        message: "Image missing alt text",
        fix: "Add alt text or mark the image decorative.",
        context: img.getAttribute("src") || undefined,
        index,
      });
      return;
    }
    if (!alt.trim()) {
      issues.push({
        id: `img-empty-alt-${index}`,
        severity: "warning",
        rule: "Image alt text",
        code: "img-alt",
        message: "Image has empty alt text",
        fix: "Confirm it is decorative or add alt text.",
        context: img.getAttribute("src") || undefined,
        index,
      });
      return;
    }
    if (/\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(alt.trim())) {
      issues.push({
        id: `img-filename-alt-${index}`,
        severity: "error",
        rule: "Image alt text",
        code: "filename-alt",
        message: `Alt text looks like a filename: "${alt.trim()}"`,
        fix: "Replace filename-style alt text with a meaningful description.",
        context: img.getAttribute("src") || undefined,
        index,
      });
    }
  });

  let previousHeadingLevel = 0;
  doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const text = (heading.textContent || "").trim();
    if (!text) {
      issues.push({
        id: `empty-heading-${index}`,
        severity: "error",
        rule: "Heading structure",
        code: "empty-heading",
        message: `${heading.tagName} is empty`,
        fix: "Remove the empty heading or add heading text.",
        index,
      });
    }
    if (previousHeadingLevel && level > previousHeadingLevel + 1) {
      issues.push({
        id: `heading-skip-${index}`,
        severity: "warning",
        rule: "Heading structure",
        code: "heading-skip",
        message: `Heading skips from H${previousHeadingLevel} to H${level}`,
        fix: `Change this heading to H${previousHeadingLevel + 1} or add an intermediate heading.`,
        context: text || undefined,
        index,
        previousLevel: previousHeadingLevel,
        currentLevel: level,
      });
    }
    previousHeadingLevel = level;
  });

  const vagueLinkText = new Set(["click here", "here", "link", "read more", "more", "learn more", "this", "view"]);
  doc.body.querySelectorAll("a").forEach((anchor, index) => {
    const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
    const href = anchor.getAttribute("href") || "";
    const normalized = text.toLowerCase();
    if (!text) {
      issues.push({
        id: `empty-link-${index}`,
        severity: "error",
        rule: "Link text",
        code: "empty-link",
        message: "Link has no readable text",
        fix: "Add descriptive link text.",
        context: href || undefined,
        index,
        text,
        href,
      });
      return;
    }
    if (vagueLinkText.has(normalized) || linkTextLooksLikeUrl(text, href)) {
      issues.push({
        id: `vague-link-${index}`,
        severity: "warning",
        rule: "Link text",
        code: "vague-link",
        message: `Non-descriptive link text: "${text}"`,
        fix: "Use link text that describes the destination.",
        context: href || undefined,
        index,
        text,
        href,
      });
      return;
    }
    if (linkLooksLikeCanvasFile(anchor, href) && textLooksLikeFileName(text)) {
      issues.push({
        id: `file-link-${index}`,
        severity: "warning",
        rule: "File links",
        code: "file-link",
        message: `File link uses filename as link text: "${text}"`,
        fix: "Use descriptive link text that explains what students will open.",
        context: href || undefined,
        index,
        text,
        href,
      });
    }
  });

  doc.body.querySelectorAll("table").forEach((table, index) => {
    if (!table.querySelector("th")) {
      issues.push({
        id: `table-header-${index}`,
        severity: "warning",
        rule: "Tables",
        code: "table-header",
        message: "Table has no header cells",
        fix: "Use header cells for row or column labels.",
        index,
      });
    }
  });

  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((element, index) => {
    const style = element.getAttribute("style") || "";
    const color = styleProperty(style, "color");
    if (!color) return;
    const foreground = parseCssColor(color);
    if (!foreground) return;
    const backgroundValue = styleProperty(style, "background-color") || styleProperty(style, "background") || "white";
    const background = parseCssColor(backgroundValue) ?? [255, 255, 255];
    const ratio = colorContrastRatio(foreground, background);
    if (ratio < 4.5) {
      issues.push({
        id: `contrast-${index}`,
        severity: ratio < 3 ? "error" : "warning",
        rule: "Color contrast",
        code: "color-contrast",
        message: `Low contrast text (${ratio.toFixed(1)}:1)`,
        fix: "Use text and background colors with at least 4.5:1 contrast.",
        context: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) || color,
        index,
      });
    }
  });

  return issues;
}

export function canFixAccessibilityIssue(issue: AccessibilityIssue) {
  return ["empty-heading", "heading-skip", "table-header", "color-contrast", "empty-link", "vague-link", "file-link"].includes(issue.code);
}

export function shouldRouteAccessibilityIssueToImages(issue: AccessibilityIssue) {
  return issue.code === "img-alt" || issue.code === "filename-alt";
}

export function accessibilityFixLabel(issue: AccessibilityIssue) {
  if (issue.code === "empty-heading") return "Remove";
  if (issue.code === "heading-skip") return "Fix Level";
  if (issue.code === "table-header") return "Add Headers";
  if (issue.code === "color-contrast") return "Remove Color";
  if (issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link") return "Improve Text";
  return "Fix";
}

export function fixAccessibilityIssueInHtml(htmlBody: string, issue: AccessibilityIssue, replacementText?: string) {
  if (typeof window === "undefined") return { html: htmlBody, fixed: false };
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");

  if (issue.code === "empty-heading") {
    const heading = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")[issue.index ?? -1];
    if (!heading) return { html: htmlBody, fixed: false };
    heading.remove();
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "heading-skip") {
    const heading = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")[issue.index ?? -1];
    const nextLevel = Math.max(1, Math.min(6, (issue.previousLevel ?? 1) + 1));
    if (!heading) return { html: htmlBody, fixed: false };
    const replacement = doc.createElement(`h${nextLevel}`);
    Array.from(heading.attributes).forEach((attr) => replacement.setAttribute(attr.name, attr.value));
    replacement.innerHTML = heading.innerHTML;
    heading.replaceWith(replacement);
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "table-header") {
    const table = doc.body.querySelectorAll("table")[issue.index ?? -1];
    const firstRow = table?.querySelector("tr");
    if (!firstRow) return { html: htmlBody, fixed: false };
    firstRow.querySelectorAll("td").forEach((cell) => {
      const header = doc.createElement("th");
      Array.from(cell.attributes).forEach((attr) => header.setAttribute(attr.name, attr.value));
      header.innerHTML = cell.innerHTML;
      cell.replaceWith(header);
    });
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "color-contrast") {
    const styledElements = Array.from(doc.body.querySelectorAll<HTMLElement>("[style]"));
    const element = styledElements[issue.index ?? -1];
    if (!element) return { html: htmlBody, fixed: false };
    const style = element.getAttribute("style") || "";
    const cleaned = style.replace(/(?:^|;)\s*color\s*:[^;]+;?/gi, ";").replace(/;{2,}/g, ";").replace(/^;|;$/g, "").trim();
    if (cleaned) element.setAttribute("style", cleaned);
    else element.removeAttribute("style");
    return { html: doc.body.innerHTML, fixed: true };
  }

  if ((issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link") && replacementText?.trim()) {
    const anchor = doc.body.querySelectorAll("a")[issue.index ?? -1];
    if (!anchor) return { html: htmlBody, fixed: false };
    anchor.textContent = replacementText.trim();
    return { html: doc.body.innerHTML, fixed: true };
  }

  return { html: htmlBody, fixed: false };
}
