"use client";

/**
 * Modal for inserting or editing raw HTML embed blocks in the editor.
 */

import { Button, Modal, ModalBody, ModalFooter } from "@/components/edplus";

const HTML_BLOCK_TEMPLATES = [
  ["YouTube", '<iframe width="560" height="315" src="https://www.youtube.com/embed/VIDEO_ID" title="YouTube video player" frameborder="0" allowfullscreen></iframe>'],
  ["Google Maps", '<iframe src="https://www.google.com/maps/embed?pb=PASTE_YOUR_EMBED_URL" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy"></iframe>'],
  ["Kaltura", '<iframe id="kaltura_player" src="https://cdnapisec.kaltura.com/p/PARTNER_ID/sp/PARTNER_ID00/embedIframeJs/uiconf_id/UICONF_ID/partner_id/PARTNER_ID?iframeembed=true&playerId=kaltura_player&entry_id=ENTRY_ID" width="560" height="395" allowfullscreen></iframe>'],
  ["Custom Block", '<div style="background:#f0f4f8;border-left:4px solid #8C1D40;padding:16px 20px;border-radius:4px;">\n  <strong>Custom Block</strong>\n  <p>Your content here.</p>\n</div>'],
] as const;

type HtmlBlockModalProps = {
  draft: string;
  mode: "insert" | "edit";
  onClose: () => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
};

export function HtmlBlockModal({
  draft,
  mode,
  onClose,
  onDraftChange,
  onSubmit,
}: HtmlBlockModalProps) {
  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={mode === "edit" ? "Edit HTML Block" : "Embed HTML / iFrame"}
      subtitle={mode === "edit" ? "Edit" : "Insert"}
      size="xl"
      className="max-h-[86vh]"
    >
      <ModalBody className="min-h-0 overflow-y-auto">
          {mode === "insert" ? (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Templates</p>
              <div className="flex flex-wrap gap-2">
                {HTML_BLOCK_TEMPLATES.map(([label, html]) => (
                  <Button
                    key={label}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDraftChange(html)}
                    className="h-auto border-outline-variant/40 bg-white px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={12}
            className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-4 py-3 font-mono text-sm leading-6 text-on-surface outline-none focus:border-primary"
            placeholder={'<iframe src="..." width="560" height="315" allowfullscreen></iframe>'}
            autoFocus
          />
          <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
            <div
              className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-sm text-on-surface"
              dangerouslySetInnerHTML={{ __html: draft }}
            />
          </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!draft.trim()} onClick={onSubmit}>
          {mode === "edit" ? "Update HTML" : "Insert HTML"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
