"use client";

/**
 * Modal for generating editor content from preset or custom AI prompts.
 */

import { Sparkles } from "lucide-react";

import { Alert, Button, Modal, ModalBody, ModalFooter } from "@/components/edplus";

const AI_GENERATE_PRESETS = [
  { label: "Learning Objectives", prompt: "Write 3-5 measurable learning objectives for this module using action verbs from Bloom's taxonomy. Format as a bulleted list." },
  { label: "Discussion Prompt", prompt: "Create an engaging discussion prompt that encourages critical thinking and peer interaction. Include a brief context paragraph and 2-3 guiding questions." },
  { label: "Module Overview", prompt: "Write a brief module overview paragraph that tells students what they will learn, why it matters, and what they will do." },
  { label: "Assignment Instructions", prompt: "Write clear assignment instructions with purpose, requirements, deliverables, and grading criteria." },
  { label: "Welcome Message", prompt: "Write a warm, professional welcome message for the start of this course module." },
];

const AI_SMART_PROMPTS = [
  { label: "Summarize this page", prompt: "Based on the current page content, write a concise summary paragraph of 2-3 sentences that captures the key points." },
  { label: "Add review questions", prompt: "Based on the current page content, create 3-5 review or comprehension questions that test understanding of the key concepts. Format as a numbered list." },
  { label: "Suggest next steps", prompt: "Based on the current page content, write a What's Next section with 2-3 bullet points guiding students to the next learning activities." },
  { label: "Make it more engaging", prompt: "Based on the current page content, suggest ways to make this more engaging, such as a discussion prompt, reflection activity, or real-world application example. Write the suggested additions as HTML." },
];

type AIGenerateModalProps = {
  context: string;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onContextChange: (context: string) => void;
  onInsert: () => void;
  onPreviewGenerate: () => void;
  onPromptChange: (prompt: string) => void;
  preview: string;
  prompt: string;
};

export function AIGenerateModal({
  context,
  error,
  loading,
  onClose,
  onContextChange,
  onInsert,
  onPreviewGenerate,
  onPromptChange,
  preview,
  prompt,
}: AIGenerateModalProps) {
  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="AI Content Generator"
      subtitle="Tools"
      size="xl"
      className="max-h-[88vh]"
    >
      <ModalBody className="min-h-0 overflow-y-auto">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Quick Prompts</p>
            <div className="flex flex-wrap gap-2">
              {AI_GENERATE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant={prompt === preset.prompt ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => onPromptChange(preset.prompt)}
                  className="h-auto px-3 py-1.5 text-xs"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Smart Prompts</p>
            <div className="flex flex-wrap gap-2">
              {AI_SMART_PROMPTS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant={prompt === preset.prompt ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onPromptChange(preset.prompt)}
                  className="h-auto px-3 py-1.5 text-xs"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <label className="block text-sm font-semibold text-on-surface">
            Prompt
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              rows={4}
              placeholder="Describe what content you want to generate..."
              className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
              autoFocus
            />
          </label>
          <label className="block text-sm font-semibold text-on-surface">
            Additional context
            <textarea
              value={context}
              onChange={(event) => onContextChange(event.target.value)}
              rows={3}
              placeholder="Optional: audience, module topic, tone, constraints, or details to include."
              className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
            />
          </label>
          <Button
            type="button"
            disabled={!prompt.trim() || loading}
            loading={loading}
            icon={<Sparkles size={16} />}
            onClick={onPreviewGenerate}
          >
            Generate
          </Button>
          {preview ? (
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
              <div
                className="canvas-content max-h-72 overflow-auto rounded-lg bg-white p-4 text-sm text-on-surface"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
          ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!preview.trim()} onClick={onInsert}>Insert into Editor</Button>
      </ModalFooter>
    </Modal>
  );
}
