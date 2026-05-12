"use client";

/**
 * Upload orchestration for editor images and files.
 *
 * This hook owns the hidden input refs, upload validation, image accessibility
 * review state, and final insertion of reviewed uploads into the draft.
 */

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

import {
  generateImageReviewText as generateImageReviewTextFromApi,
  loadImageReview,
  saveImageReview,
  uploadEditorFile,
  uploadEditorImage,
} from "@/modules/editor/api/editorClient";
import type { ContentEditorItem, EditorImageReviewState } from "@/modules/editor/types";
import {
  buildManagedImageBlockHtml,
  managedImageBlockLabel,
  type ManagedImageInsertMode,
} from "@/modules/editor/utils/contentBlocks";
import { escapeAttribute, escapeHtml } from "@/modules/editor/utils/html";

type UseEditorUploadsParams = {
  editor: Editor | null;
  getAccessToken: () => Promise<string>;
  insertHtmlBlockIntoDraft: (html: string, successMessage?: string) => boolean;
  item: ContentEditorItem;
  sessionId: string;
  setMessage: (value: string | null) => void;
};

const allowedFileExtensions = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".csv", ".xls", ".xlsx"];

function normalizeImageInsertMode(insertMode: unknown): ManagedImageInsertMode {
  if (
    insertMode === "imageText" ||
    insertMode === "imageCard" ||
    insertMode === "profileCard" ||
    insertMode === "fullWidthImage" ||
    insertMode === "testimonial"
  ) {
    return insertMode;
  }
  return "image";
}

export function useEditorUploads({
  editor,
  getAccessToken,
  insertHtmlBlockIntoDraft,
  item,
  sessionId,
  setMessage,
}: UseEditorUploadsParams) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [imageReview, setImageReview] = useState<EditorImageReviewState | null>(null);
  const [imageReviewAlt, setImageReviewAlt] = useState("");
  const [imageReviewLongDescription, setImageReviewLongDescription] = useState("");
  const [imageReviewDecorative, setImageReviewDecorative] = useState(false);
  const [imageReviewSaving, setImageReviewSaving] = useState(false);
  const [imageReviewGenerating, setImageReviewGenerating] = useState<"alt" | "long_desc" | "both" | null>(null);
  const [imageReviewError, setImageReviewError] = useState<string | null>(null);

  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const pendingImageInsertModeRef = useRef<ManagedImageInsertMode>("image");
  const pendingFileLinkSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);

  const resetImageReview = useCallback(() => {
    setImageReview(null);
    setImageReviewAlt("");
    setImageReviewLongDescription("");
    setImageReviewDecorative(false);
    setImageReviewError(null);
    pendingImageInsertModeRef.current = "image";
  }, []);

  const uploadImage = useCallback((insertMode: ManagedImageInsertMode = "image") => {
    if (!editor || uploadingImage) return;
    pendingImageInsertModeRef.current = normalizeImageInsertMode(insertMode);
    imageUploadInputRef.current?.click();
  }, [editor, uploadingImage]);

  const uploadFile = useCallback(() => {
    if (!editor || uploadingFile) return;
    const { from, to, empty } = editor.state.selection;
    pendingFileLinkSelectionRef.current = empty
      ? null
      : { from, to, text: editor.state.doc.textBetween(from, to, " ").trim() };
    fileUploadInputRef.current?.click();
  }, [editor, uploadingFile]);

  const handleImageUpload = useCallback(async (file: File | null) => {
    if (!file || !editor) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file to upload.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Choose an image that is 10 MB or smaller.");
      return;
    }

    setUploadingImage(true);
    setMessage(null);
    const insertMode = pendingImageInsertModeRef.current;
    try {
      const token = await getAccessToken();
      const data = await uploadEditorImage(sessionId, item.id, token, file);
      setImageReview({
        imageId: data.image.id,
        src: data.insert.src,
        title: data.insert.title || file.name,
        canvasFileId: data.insert.canvas_file_id ?? null,
        insertMode,
      });
      setImageReviewAlt(data.image.edited_alt_text || data.insert.alt || "");
      setImageReviewLongDescription(data.image.long_description || "");
      setImageReviewDecorative(Boolean(data.image.is_decorative));
      setImageReviewError(null);
      setMessage(
        insertMode !== "image"
          ? `Uploaded image to Canvas Files. Add alt text or mark it decorative to insert the ${managedImageBlockLabel(insertMode)} block.`
          : "Uploaded image to Canvas Files. Add alt text or mark it decorative to insert it."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = "";
      }
    }
  }, [editor, getAccessToken, item.id, sessionId, setMessage]);

  const handleFileUpload = useCallback(async (file: File | null) => {
    if (!file || !editor) return;
    const lowerName = file.name.toLowerCase();
    if (!allowedFileExtensions.some((extension) => lowerName.endsWith(extension))) {
      setMessage("Choose a PDF, Word, PowerPoint, CSV, or Excel file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMessage("Choose a file that is 50 MB or smaller.");
      return;
    }

    setUploadingFile(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const data = await uploadEditorFile(sessionId, item.id, token, file);
      const selection = pendingFileLinkSelectionRef.current;
      const linkText = selection?.text || data.insert.text || file.name;
      const linkHtml = `<a href="${escapeAttribute(data.insert.href)}" data-api-endpoint="${escapeAttribute(data.insert.href)}" data-api-returntype="File">${escapeHtml(linkText)}</a>`;
      if (selection && selection.from < selection.to) {
        const docSize = editor.state.doc.content.size;
        const from = Math.max(0, Math.min(selection.from, docSize));
        const to = Math.max(from, Math.min(selection.to, docSize));
        editor.chain().focus().insertContentAt({ from, to }, linkHtml).run();
      } else {
        editor.chain().focus().insertContent(linkHtml).run();
      }
      const issueCount = data.file.initial_accessibility_review?.issues.length ?? 0;
      setMessage(
        issueCount
          ? `Uploaded ${data.file.filename} to Canvas Files and ${selection ? "linked the selected text" : "inserted a link"}. Initial PDF review found ${issueCount} item${issueCount === 1 ? "" : "s"} for later document remediation.`
          : `Uploaded ${data.file.filename} to Canvas Files and ${selection ? "linked the selected text" : "inserted a link"}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload file");
    } finally {
      setUploadingFile(false);
      pendingFileLinkSelectionRef.current = null;
      if (fileUploadInputRef.current) {
        fileUploadInputRef.current.value = "";
      }
    }
  }, [editor, getAccessToken, item.id, sessionId, setMessage]);

  const generateImageReviewText = useCallback(async (mode: "alt" | "long_desc" | "both") => {
    if (!imageReview || imageReviewDecorative) return;
    setImageReviewGenerating(mode);
    setImageReviewError(null);
    try {
      const token = await getAccessToken();
      let data = await generateImageReviewTextFromApi(sessionId, imageReview.imageId, token, mode);
      const wasQueued = Boolean(data.job_id);
      if (wasQueued) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          data = await loadImageReview(sessionId, imageReview.imageId, token).catch(() => data);
          const hasRequestedText =
            mode === "alt"
              ? Boolean(data.edited_alt_text)
              : mode === "long_desc"
                ? Boolean(data.long_description)
                : Boolean(data.edited_alt_text) && Boolean(data.long_description);
          if (hasRequestedText) break;
        }
      }
      if (data.edited_alt_text !== undefined) setImageReviewAlt(data.edited_alt_text || "");
      if (data.long_description !== undefined) setImageReviewLongDescription(data.long_description || "");
      if (data.is_decorative !== undefined) setImageReviewDecorative(Boolean(data.is_decorative));
      if (wasQueued && (
        (mode === "alt" && !data.edited_alt_text) ||
        (mode === "long_desc" && !data.long_description) ||
        (mode === "both" && (!data.edited_alt_text || !data.long_description))
      )) {
        setImageReviewError("Image text generation is queued. Reopen this image review after the worker finishes.");
      }
    } catch (error) {
      setImageReviewError(error instanceof Error ? error.message : "Failed to generate image text");
    } finally {
      setImageReviewGenerating(null);
    }
  }, [getAccessToken, imageReview, imageReviewDecorative, sessionId]);

  const saveReviewedImageAndInsert = useCallback(async () => {
    if (!imageReview || !editor) return;
    const finalAlt = imageReviewAlt.trim();
    const finalLongDescription = imageReviewLongDescription.trim();
    if (!imageReviewDecorative && !finalAlt) {
      setImageReviewError("Add alt text or mark the image as decorative before inserting it.");
      return;
    }

    setImageReviewSaving(true);
    setImageReviewError(null);
    try {
      const token = await getAccessToken();
      await saveImageReview(sessionId, imageReview.imageId, token, {
        edited_alt_text: imageReviewDecorative ? null : finalAlt,
        long_description: imageReviewDecorative ? null : finalLongDescription || null,
        is_decorative: imageReviewDecorative,
        review_action: "keep",
      });

      if (imageReview.insertMode !== "image") {
        const inserted = insertHtmlBlockIntoDraft(buildManagedImageBlockHtml({
          alt: finalAlt,
          canvasFileId: imageReview.canvasFileId,
          decorative: imageReviewDecorative,
          mode: imageReview.insertMode,
          src: imageReview.src,
          title: imageReview.title,
        }));
        if (!inserted) return;
      } else {
        const attrs: {
          src: string;
          alt: string;
          title?: string;
          role?: string;
          "data-canvas-file-id"?: string;
          "data-decorative"?: string;
        } = {
          src: imageReview.src,
          alt: imageReviewDecorative ? "" : finalAlt,
        };
        if (imageReview.title) attrs.title = imageReview.title;
        if (imageReview.canvasFileId) attrs["data-canvas-file-id"] = imageReview.canvasFileId;
        if (imageReviewDecorative) {
          attrs.role = "presentation";
          attrs["data-decorative"] = "true";
        }
        editor.chain().focus().setImage(attrs).run();
      }
      setImageReview(null);
      setImageReviewAlt("");
      setImageReviewLongDescription("");
      setImageReviewDecorative(false);
      pendingImageInsertModeRef.current = "image";
      setMessage(
        imageReview.insertMode !== "image"
          ? `Inserted reviewed ${managedImageBlockLabel(imageReview.insertMode)} block into the draft.`
          : "Inserted reviewed image into the draft."
      );
    } catch (error) {
      setImageReviewError(error instanceof Error ? error.message : "Failed to save image accessibility text");
    } finally {
      setImageReviewSaving(false);
    }
  }, [
    editor,
    getAccessToken,
    imageReview,
    imageReviewAlt,
    imageReviewDecorative,
    imageReviewLongDescription,
    insertHtmlBlockIntoDraft,
    sessionId,
    setMessage,
  ]);

  return {
    fileUploadInputRef,
    generateImageReviewText,
    handleFileUpload,
    handleImageUpload,
    imageReview,
    imageReviewAlt,
    imageReviewDecorative,
    imageReviewError,
    imageReviewGenerating,
    imageReviewLongDescription,
    imageReviewSaving,
    imageUploadInputRef,
    resetImageReview,
    saveReviewedImageAndInsert,
    setImageReviewAlt,
    setImageReviewDecorative,
    setImageReviewLongDescription,
    uploadingFile,
    uploadingImage,
    uploadFile,
    uploadImage,
  };
}
