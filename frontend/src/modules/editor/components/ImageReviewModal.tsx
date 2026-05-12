"use client";

/**
 * Modal for reviewing uploaded images before inserting them into editor content.
 */

import { managedImageBlockLabel } from "@/modules/editor/utils/contentBlocks";
import type { EditorImageReviewState } from "@/modules/editor/types";
import { Alert, Button, Modal, ModalBody, ModalFooter } from "@/components/edplus";

export type { EditorImageReviewState } from "@/modules/editor/types";

type ImageReviewModalProps = {
  altText: string;
  decorative: boolean;
  error: string | null;
  generating: "alt" | "long_desc" | "both" | null;
  imageReview: EditorImageReviewState;
  longDescription: string;
  onAltTextChange: (value: string) => void;
  onCancel: () => void;
  onDecorativeChange: (value: boolean) => void;
  onGenerate: (mode: "alt" | "long_desc" | "both") => void;
  onLongDescriptionChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
};

export function ImageReviewModal({
  altText,
  decorative,
  error,
  generating,
  imageReview,
  longDescription,
  onAltTextChange,
  onCancel,
  onDecorativeChange,
  onGenerate,
  onLongDescriptionChange,
  onSave,
  saving,
}: ImageReviewModalProps) {
  const generatingAny = Boolean(generating);

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="Add Accessibility Text"
      subtitle="Uploaded Image"
      size="2xl"
      className="max-h-[92vh]"
    >
      <ModalBody className="grid max-h-[calc(92vh-9rem)] gap-0 overflow-hidden p-0 lg:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1fr)]">
        <div className="flex min-h-0 flex-none items-center justify-center bg-surface-container-low p-3 lg:h-full lg:flex-auto lg:p-4">
          <div className="flex h-[clamp(180px,30vh,280px)] w-full items-center justify-center rounded-xl border border-outline-variant/30 bg-white p-2 lg:h-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- Canvas upload previews use authenticated, arbitrary Canvas file URLs. */}
            <img
              src={imageReview.src}
              alt=""
              className="h-full max-h-full w-full max-w-full object-contain"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div>
            <p className="text-sm text-on-surface-variant">
              This image was uploaded to Canvas Files. Add alt text or mark it decorative before inserting
              {imageReview.insertMode !== "image" ? ` the ${managedImageBlockLabel(imageReview.insertMode)} block` : " it"} into the draft.
            </p>
          </div>

          {error ? <Alert variant="error" className="mt-4">{error}</Alert> : null}

          <label className="mt-5 flex items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
            <input
              type="checkbox"
              checked={decorative}
              onChange={(event) => onDecorativeChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <span>
              <span className="block text-sm font-semibold text-on-surface">Decorative image</span>
              <span className="block text-xs text-on-surface-variant">
                Decorative images are inserted with empty alt text and presentation role.
              </span>
            </span>
          </label>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="uploaded-image-alt" className="text-sm font-semibold text-on-surface">
                Alt text
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={decorative || generatingAny || saving}
                loading={generating === "alt"}
                onClick={() => onGenerate("alt")}
                className="h-auto px-2.5 py-1.5 text-xs"
              >
                Generate
              </Button>
            </div>
            <textarea
              id="uploaded-image-alt"
              value={altText}
              disabled={decorative}
              onChange={(event) => onAltTextChange(event.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary disabled:opacity-50"
              placeholder={decorative ? "Decorative images use empty alt text." : "Describe the image for someone who cannot see it."}
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="uploaded-image-long-description" className="text-sm font-semibold text-on-surface">
                Long description
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={decorative || generatingAny || saving}
                loading={generating === "long_desc"}
                onClick={() => onGenerate("long_desc")}
                className="h-auto px-2.5 py-1.5 text-xs"
              >
                Generate
              </Button>
            </div>
            <textarea
              id="uploaded-image-long-description"
              value={longDescription}
              disabled={decorative}
              onChange={(event) => onLongDescriptionChange(event.target.value)}
              rows={5}
              className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary disabled:opacity-50"
              placeholder="Optional for complex images, charts, diagrams, or screenshots."
            />
          </div>

        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" disabled={saving || generatingAny} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={decorative || generatingAny || saving}
          loading={generating === "both"}
          onClick={() => onGenerate("both")}
        >
          Generate Both
        </Button>
        <Button
          type="button"
          disabled={saving || generatingAny || (!decorative && !altText.trim())}
          loading={saving}
          onClick={onSave}
        >
          {imageReview.insertMode !== "image" ? "Save and Insert Block" : "Save and Insert"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
