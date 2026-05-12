"use client";

/**
 * Modal for inserting supported video embed URLs into the editor.
 */

import { Alert, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { parseVideoEmbedUrl } from "@/modules/editor/utils/contentBlocks";

type VideoEmbedModalProps = {
  error: string | null;
  onClose: () => void;
  onErrorChange: (error: string | null) => void;
  onSubmit: () => void;
  onUrlChange: (url: string) => void;
  url: string;
};

export function VideoEmbedModal({
  error,
  onClose,
  onErrorChange,
  onSubmit,
  onUrlChange,
  url,
}: VideoEmbedModalProps) {
  const parsed = parseVideoEmbedUrl(url);

  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Embed Video" subtitle="Insert" size="lg" className="max-h-[86vh]">
      <ModalBody className="min-h-0 overflow-y-auto">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Input
          label="Video URL"
          type="text"
          value={url}
          onChange={(event) => {
            onUrlChange(event.target.value);
            onErrorChange(null);
          }}
          placeholder="https://www.youtube.com/watch?v=..."
          autoFocus
          fullWidth
        />
          {parsed?.embedUrl ? (
            <div className="mt-4 overflow-hidden rounded-xl bg-black" style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
              <iframe src={parsed.embedUrl} className="absolute inset-0 h-full w-full border-0" allowFullScreen title="Video preview" />
            </div>
          ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={onSubmit}>Insert Video</Button>
      </ModalFooter>
    </Modal>
  );
}
