"use client";

/**
 * AI-assisted editor operations.
 *
 * Keeps selection rewrites, accessibility link text improvement, and generated
 * content modal state out of the workspace shell.
 */

import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";

import {
  generateEditorContent,
  rewriteEditorText,
} from "@/modules/editor/api/editorClient";
import type { AccessibilityIssue } from "@/modules/editor/utils/accessibility";
import { editorPlainText } from "@/modules/editor/utils/html";

type UseEditorAIParams = {
  editor: Editor | null;
  getAccessToken: () => Promise<string>;
  sessionId: string;
  setMessage: (value: string | null) => void;
};

export function useEditorAI({
  editor,
  getAccessToken,
  sessionId,
  setMessage,
}: UseEditorAIParams) {
  const [aiGenerateModalOpen, setAiGenerateModalOpen] = useState(false);
  const [aiGeneratePrompt, setAiGeneratePrompt] = useState("");
  const [aiGenerateContext, setAiGenerateContext] = useState("");
  const [aiGeneratePreview, setAiGeneratePreview] = useState("");
  const [aiGenerateLoading, setAiGenerateLoading] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState<string | null>(null);

  const openAIGenerate = useCallback(() => {
    setAiGeneratePrompt("");
    setAiGenerateContext("");
    setAiGeneratePreview("");
    setAiGenerateError(null);
    setAiGenerateModalOpen(true);
  }, []);

  const closeAIGenerate = useCallback(() => {
    setAiGenerateModalOpen(false);
  }, []);

  const improveAccessibilityLinkText = useCallback(async (issue: AccessibilityIssue) => {
    const token = await getAccessToken();
    const data = await rewriteEditorText(
      sessionId,
      token,
      {
        text: issue.text || "link",
        instruction: `This course link text is inaccessible, vague, or only a filename. Destination URL: ${issue.href || "unknown"}. Generate concise, descriptive replacement link text in 3-8 words. Return only the replacement text.`,
        context: editorPlainText(editor, 3000),
      },
      "Failed to improve link text",
    );
    const replacementText = data.result?.trim().replace(/^["']|["']$/g, "");
    if (!replacementText) throw new Error("AI returned an empty response.");
    return replacementText;
  }, [editor, getAccessToken, sessionId]);

  const rewriteSelectionWithAI = useCallback(async (text: string, instruction: string) => {
    const token = await getAccessToken();
    const data = await rewriteEditorText(
      sessionId,
      token,
      {
        text,
        instruction,
        context: editorPlainText(editor, 3000),
      },
      "Failed to rewrite selection",
    );
    const result = data.result?.trim();
    if (!result) throw new Error("AI returned an empty response.");
    return result;
  }, [editor, getAccessToken, sessionId]);

  const generateAIContent = useCallback(async () => {
    if (!aiGeneratePrompt.trim() || !editor) return;
    setAiGenerateLoading(true);
    setAiGenerateError(null);
    setAiGeneratePreview("");
    try {
      const token = await getAccessToken();
      const data = await generateEditorContent(
        sessionId,
        token,
        {
          prompt: aiGeneratePrompt.trim(),
          additional_context: aiGenerateContext.trim() || null,
          context: editorPlainText(editor, 5000),
        },
      );
      if (!data.html?.trim()) throw new Error("AI returned an empty response.");
      setAiGeneratePreview(data.html.trim());
    } catch (err) {
      setAiGenerateError(err instanceof Error ? err.message : "Failed to generate content");
    } finally {
      setAiGenerateLoading(false);
    }
  }, [aiGenerateContext, aiGeneratePrompt, editor, getAccessToken, sessionId]);

  const insertAIContent = useCallback(() => {
    if (!editor || !aiGeneratePreview.trim()) return;
    editor.chain().focus().insertContent(aiGeneratePreview).run();
    setAiGenerateModalOpen(false);
    setAiGeneratePrompt("");
    setAiGenerateContext("");
    setAiGeneratePreview("");
    setMessage("Inserted AI generated content into the draft.");
  }, [aiGeneratePreview, editor, setMessage]);

  return {
    aiGenerateContext,
    aiGenerateError,
    aiGenerateLoading,
    aiGenerateModalOpen,
    aiGeneratePreview,
    aiGeneratePrompt,
    closeAIGenerate,
    generateAIContent,
    improveAccessibilityLinkText,
    insertAIContent,
    openAIGenerate,
    rewriteSelectionWithAI,
    setAiGenerateContext,
    setAiGeneratePrompt,
  };
}
