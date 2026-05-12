"use client";

/**
 * Modal for inserting or editing LaTeX equation blocks.
 */

import { useRef } from "react";

import { Alert, Button, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { renderLatexDisplay } from "@/modules/editor/utils/contentBlocks";

const LATEX_OPERATION_GROUPS = [
  {
    label: "Basic",
    items: [
      { label: "Fraction", symbol: "a/b", value: "\\frac{}{}" },
      { label: "Square root", symbol: "√", value: "\\sqrt{}" },
      { label: "Power", symbol: "xⁿ", value: "^{}" },
      { label: "Subscript", symbol: "xₙ", value: "_{}" },
      { label: "Plus/minus", symbol: "±", value: "\\pm" },
      { label: "Times", symbol: "×", value: "\\times" },
      { label: "Divide", symbol: "÷", value: "\\div" },
      { label: "Dot", symbol: "⋅", value: "\\cdot" },
    ],
  },
  {
    label: "Calculus",
    items: [
      { label: "Integral", symbol: "∫", value: "\\int" },
      { label: "Double integral", symbol: "∬", value: "\\iint" },
      { label: "Sum", symbol: "∑", value: "\\sum" },
      { label: "Product", symbol: "∏", value: "\\prod" },
      { label: "Limit", symbol: "lim", value: "\\lim_{x \\to 0}" },
      { label: "Derivative", symbol: "d/dx", value: "\\frac{d}{dx}" },
      { label: "Partial", symbol: "∂", value: "\\partial" },
      { label: "Gradient", symbol: "∇", value: "\\nabla" },
    ],
  },
  {
    label: "Relations",
    items: [
      { label: "Less/equal", symbol: "≤", value: "\\le" },
      { label: "Greater/equal", symbol: "≥", value: "\\ge" },
      { label: "Not equal", symbol: "≠", value: "\\ne" },
      { label: "Approx", symbol: "≈", value: "\\approx" },
      { label: "Equivalent", symbol: "≡", value: "\\equiv" },
      { label: "Proportional", symbol: "∝", value: "\\propto" },
      { label: "Infinity", symbol: "∞", value: "\\infty" },
      { label: "Angle", symbol: "∠", value: "\\angle" },
    ],
  },
  {
    label: "Sets & Logic",
    items: [
      { label: "Element", symbol: "∈", value: "\\in" },
      { label: "Not element", symbol: "∉", value: "\\notin" },
      { label: "Subset", symbol: "⊆", value: "\\subseteq" },
      { label: "Union", symbol: "∪", value: "\\cup" },
      { label: "Intersect", symbol: "∩", value: "\\cap" },
      { label: "For all", symbol: "∀", value: "\\forall" },
      { label: "Exists", symbol: "∃", value: "\\exists" },
      { label: "Empty set", symbol: "∅", value: "\\emptyset" },
    ],
  },
  {
    label: "Greek",
    items: [
      { label: "alpha", symbol: "α", value: "\\alpha" },
      { label: "beta", symbol: "β", value: "\\beta" },
      { label: "gamma", symbol: "γ", value: "\\gamma" },
      { label: "delta", symbol: "δ", value: "\\delta" },
      { label: "theta", symbol: "θ", value: "\\theta" },
      { label: "lambda", symbol: "λ", value: "\\lambda" },
      { label: "pi", symbol: "π", value: "\\pi" },
      { label: "sigma", symbol: "σ", value: "\\sigma" },
      { label: "omega", symbol: "ω", value: "\\omega" },
      { label: "Delta", symbol: "Δ", value: "\\Delta" },
      { label: "Sigma", symbol: "Σ", value: "\\Sigma" },
      { label: "Omega", symbol: "Ω", value: "\\Omega" },
    ],
  },
];

type LatexModalProps = {
  displayMode: boolean;
  draft: string;
  error: string | null;
  mode: "insert" | "edit";
  onClose: () => void;
  onDisplayModeChange: (displayMode: boolean) => void;
  onDraftChange: (draft: string) => void;
  onErrorChange: (error: string | null) => void;
  onSubmit: () => void;
};

export function LatexModal({
  displayMode,
  draft,
  error,
  mode,
  onClose,
  onDisplayModeChange,
  onDraftChange,
  onErrorChange,
  onSubmit,
}: LatexModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertLatexSnippet(snippet: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      onDraftChange(`${draft}${draft.endsWith(" ") || !draft ? "" : " "}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${draft.slice(0, start)}${snippet}${draft.slice(end)}`;
    onDraftChange(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + snippet.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={mode === "edit" ? "Edit Equation" : "LaTeX Equation"}
      subtitle={mode === "edit" ? "Edit" : "Insert"}
      size="lg"
      className="max-h-[86vh]"
    >
      <ModalBody className="min-h-0 overflow-y-auto">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={displayMode ? "primary" : "secondary"}
              size="sm"
              onClick={() => onDisplayModeChange(true)}
            >
              Display
            </Button>
            <Button
              type="button"
              variant={!displayMode ? "primary" : "secondary"}
              size="sm"
              onClick={() => onDisplayModeChange(false)}
            >
              Inline
            </Button>
          </div>
          <label className="block text-sm font-semibold text-on-surface">
            Equation
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                onDraftChange(event.target.value);
                onErrorChange(null);
              }}
              rows={6}
              placeholder="E = mc^2"
              className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 font-mono text-sm font-normal text-on-surface outline-none focus:border-primary"
              autoFocus
            />
          </label>
          <div className="mt-4 space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Operations</p>
            {LATEX_OPERATION_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-semibold text-on-surface-variant">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <button
                      key={`${group.label}-${item.label}`}
                      type="button"
                      onClick={() => insertLatexSnippet(item.value)}
                      className="group relative inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-outline-variant/40 bg-white px-2.5 font-mono text-base font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                      aria-label={`${item.label}: ${item.value}`}
                      title={`${item.label}: ${item.value}`}
                    >
                      {item.symbol}
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-on-surface px-2 py-1 font-sans text-[11px] font-semibold text-surface-container-lowest shadow-lg group-hover:block">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
            <div
              className="rounded-lg bg-white p-3 font-serif text-lg text-on-surface"
              style={{ textAlign: displayMode ? "center" : "left" }}
              dangerouslySetInnerHTML={{ __html: draft.trim() ? renderLatexDisplay(draft) : "Enter an equation above." }}
            />
          </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={onSubmit}>
          {mode === "edit" ? "Update Equation" : "Insert Equation"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
