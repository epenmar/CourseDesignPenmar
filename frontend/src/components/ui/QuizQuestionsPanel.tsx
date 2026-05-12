"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EditorContent, Mark, mergeAttributes, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { Alert, Button, Card, Input } from "@/components/edplus";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type QuizAnswer = {
  id?: number;
  text?: string;
  html?: string;
  weight?: number;
  answer_text?: string;
  answer_html?: string;
  answer_weight?: number;
  blank_id?: string;
  left?: string;
  right?: string;
  answer_match_left?: string;
  answer_match_right?: string;
  matching_answer_incorrect_matches?: string;
  match_id?: number;
  numerical_answer_type?: string;
  exact?: number;
  margin?: number;
  approximate?: number;
  precision?: number;
  start?: number;
  end?: number;
};

type QuizQuestion = {
  content_item_id?: string;
  canvas_id: string | number;
  quiz_id: string | number;
  question_text: string;
  question_type: string;
  points_possible: number;
  position: number;
  answers: QuizAnswer[];
};

type QuizQuestionEdit = {
  question_text: string;
  question_type: string;
  points_possible: number;
  answers: QuizAnswer[];
};

const QUESTION_TYPES = [
  { value: "multiple_choice_question", label: "Multiple Choice" },
  { value: "true_false_question", label: "True/False" },
  { value: "essay_question", label: "Essay" },
  { value: "fill_in_multiple_blanks_question", label: "Fill in Multiple Blanks" },
  { value: "multiple_answers_question", label: "Multiple Answers" },
  { value: "matching_question", label: "Matching" },
  { value: "numerical_question", label: "Numerical" },
  { value: "calculated_question", label: "Calculated" },
  { value: "multiple_dropdowns_question", label: "Multiple Dropdowns" },
  { value: "file_upload_question", label: "File Upload" },
  { value: "text_only_question", label: "Text Only" },
];

const NO_ANSWER_TYPES = new Set(["essay_question", "file_upload_question", "text_only_question", "calculated_question"]);
const NO_CORRECT_TOGGLE_TYPES = new Set(["matching_question", "multiple_dropdowns_question", "fill_in_multiple_blanks_question", "numerical_question"]);

const SubscriptMark = Mark.create({
  name: "subscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },
});

const SuperscriptMark = Mark.create({
  name: "superscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },
});

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function typeLabel(value: string) {
  return QUESTION_TYPES.find((type) => type.value === value)?.label ?? value.replaceAll("_", " ");
}

function normalizeAnswerForEdit(answer: QuizAnswer): QuizAnswer {
  const weight = answer.weight ?? answer.answer_weight ?? 0;
  return {
    ...answer,
    text: answer.text ?? answer.answer_text ?? "",
    html: answer.html ?? answer.answer_html,
    weight,
    answer_weight: weight,
  };
}

function editFromQuestion(question: QuizQuestion): QuizQuestionEdit {
  return {
    question_text: question.question_text || "",
    question_type: question.question_type || "multiple_choice_question",
    points_possible: question.points_possible || 0,
    answers: (question.answers ?? []).map((answer) => normalizeAnswerForEdit(answer)),
  };
}

function matchingPrompt(answer: QuizAnswer) {
  return answer.answer_match_left ?? answer.left ?? answer.text ?? answer.answer_text ?? "";
}

function matchingMatch(answer: QuizAnswer) {
  return answer.answer_match_right ?? answer.right ?? "";
}

function numericalAnswerLabel(answer: QuizAnswer) {
  const answerType = answer.numerical_answer_type ?? "exact_answer";
  if (answerType === "range_answer") return `${answer.start ?? ""} to ${answer.end ?? ""}`;
  if (answerType === "precision_answer") return `${answer.approximate ?? ""} with precision ${answer.precision ?? 1}`;
  return `${answer.exact ?? ""}${answer.margin !== undefined ? ` +/- ${answer.margin}` : ""}`;
}

function questionKey(question: QuizQuestion) {
  return String(question.content_item_id ?? question.canvas_id);
}

function defaultAnswersForType(questionType: string): QuizAnswer[] {
  if (questionType === "true_false_question") {
    return [
      { text: "True", answer_text: "True", weight: 100, answer_weight: 100 },
      { text: "False", answer_text: "False", weight: 0, answer_weight: 0 },
    ];
  }
  if (questionType === "multiple_choice_question" || questionType === "multiple_answers_question") {
    return [
      { text: "Option A", html: "Option A", weight: 100 },
      { text: "Option B", html: "Option B", weight: 0 },
      { text: "Option C", html: "Option C", weight: 0 },
      { text: "Option D", html: "Option D", weight: 0 },
    ];
  }
  if (questionType === "matching_question") {
    return [
      { answer_match_left: "Prompt 1", answer_match_right: "Match 1", left: "Prompt 1", right: "Match 1", text: "Prompt 1" },
      { answer_match_left: "Prompt 2", answer_match_right: "Match 2", left: "Prompt 2", right: "Match 2", text: "Prompt 2" },
    ];
  }
  if (questionType === "numerical_question") {
    return [{ numerical_answer_type: "exact_answer", exact: 0, margin: 0, weight: 100 }];
  }
  if (questionType === "fill_in_multiple_blanks_question" || questionType === "multiple_dropdowns_question") {
    return [
      { blank_id: "answer1", text: "Option A", weight: 100 },
      { blank_id: "answer1", text: "Option B", weight: 0 },
    ];
  }
  return [];
}

function MiniButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={`h-8 min-w-8 border-0 px-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40 ${
        active ? "bg-surface-container-high text-on-surface ring-1 ring-outline-variant/60" : ""
      }`}
    >
      {children}
    </Button>
  );
}

function CompactRichTextField({
  allowLists = false,
  minHeight = 90,
  onChange,
  value,
}: {
  allowLists?: boolean;
  minHeight?: number;
  onChange: (html: string) => void;
  value: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      SubscriptMark,
      SuperscriptMark,
    ],
    content: value || "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[var(--quiz-field-min-height)] px-3 py-2 text-sm leading-6 text-on-surface outline-none",
        style: `--quiz-field-min-height: ${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    if ((value || "") !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  const setLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("URL", existing || "https://");
    if (next === null) return;
    if (!next.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: next.trim() }).run();
  };

  return (
    <div className="quiz-rich-text overflow-hidden rounded-xl border border-outline-variant/40 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/30 bg-surface-container-low px-2 py-1">
        <MiniButton label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <span className="text-sm font-black">B</span>
        </MiniButton>
        <MiniButton label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <span className="text-sm font-black italic">I</span>
        </MiniButton>
        <MiniButton label="Underline" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <span className="text-sm font-black underline">U</span>
        </MiniButton>
        {allowLists ? (
          <>
            <MiniButton label="Bulleted list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>Bullets</MiniButton>
            <MiniButton label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>Numbers</MiniButton>
          </>
        ) : null}
        <MiniButton label="Link" active={editor?.isActive("link")} onClick={setLink}>Link</MiniButton>
        <MiniButton label="Clear formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>Clear</MiniButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

export function QuizQuestionsPanel({
  contentItemId,
  editing,
  sessionId,
}: {
  contentItemId: string;
  editing: boolean;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [edits, setEdits] = useState<Record<string, QuizQuestionEdit>>({});
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | number | null>(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [adding, setAdding] = useState(false);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/quiz-questions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Unable to load quiz questions."));
      const data = await res.json() as { status: "ok" | "unsupported"; questions: QuizQuestion[]; message?: string };
      setQuestions(data.questions ?? []);
      setStatusMessage(data.status === "unsupported" ? data.message ?? "Quiz questions are not editable for this quiz." : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load quiz questions.");
    } finally {
      setLoading(false);
    }
  }, [contentItemId, sessionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQuestions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadQuestions]);

  useEffect(() => {
    function handleQuestionsChanged() {
      void loadQuestions();
    }
    window.addEventListener("canvascurate:quiz-questions-updated", handleQuestionsChanged);
    return () => window.removeEventListener("canvascurate:quiz-questions-updated", handleQuestionsChanged);
  }, [loadQuestions]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!editing) {
        setEdits({});
        return;
      }
      setEdits((previous) => {
        const next = { ...previous };
        for (const question of questions) {
          if (!next[questionKey(question)]) next[questionKey(question)] = editFromQuestion(question);
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [editing, questions]);

  const updateEdit = (questionId: string | number, patch: Partial<QuizQuestionEdit>) => {
    const key = String(questionId);
    setEdits((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
  };

  const updateAnswer = (questionId: string | number, index: number, patch: Partial<QuizAnswer>) => {
    const key = String(questionId);
    setEdits((previous) => {
      const edit = previous[key];
      if (!edit) return previous;
      return {
        ...previous,
        [key]: {
          ...edit,
          answers: edit.answers.map((answer, answerIndex) => answerIndex === index ? { ...answer, ...patch } : answer),
        },
      };
    });
  };

  const changeQuestionType = (questionId: string | number, questionType: string) => {
    const key = String(questionId);
    setEdits((previous) => {
      const edit = previous[key];
      if (!edit) return previous;
      return {
        ...previous,
        [key]: {
          ...edit,
          question_type: questionType,
          points_possible: questionType === "text_only_question" ? 0 : edit.points_possible,
          answers: defaultAnswersForType(questionType),
        },
      };
    });
  };

  const addAnswer = (questionId: string | number, template: QuizAnswer = {}) => {
    const key = String(questionId);
    setEdits((previous) => {
      const edit = previous[key];
      if (!edit) return previous;
      return { ...previous, [key]: { ...edit, answers: [...edit.answers, { text: "", html: "", weight: 0, ...template }] } };
    });
  };

  const removeAnswer = (questionId: string | number, index: number) => {
    const key = String(questionId);
    setEdits((previous) => {
      const edit = previous[key];
      if (!edit) return previous;
      return { ...previous, [key]: { ...edit, answers: edit.answers.filter((_, answerIndex) => answerIndex !== index) } };
    });
  };

  const toggleCorrect = (questionId: string | number, index: number, allowMultiple: boolean) => {
    const key = String(questionId);
    setEdits((previous) => {
      const edit = previous[key];
      if (!edit) return previous;
      return {
        ...previous,
        [key]: {
          ...edit,
          answers: edit.answers.map((answer, answerIndex) => {
            if (answerIndex === index) {
              const weight = allowMultiple && (answer.weight ?? 0) > 0 ? 0 : 100;
              return { ...answer, weight, answer_weight: weight };
            }
            return allowMultiple ? answer : { ...answer, weight: 0, answer_weight: 0 };
          }),
        },
      };
    });
  };

  const saveQuestion = async (question: QuizQuestion) => {
    const key = questionKey(question);
    const edit = edits[key];
    if (!edit) return;
    setSavingId(key);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/quiz-questions/${questionKey(question)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Unable to save quiz question."));
      const data = await res.json() as { question: QuizQuestion };
      setQuestions((previous) => previous.map((row) => questionKey(row) === key ? data.question : row));
      setEdits((previous) => ({ ...previous, [questionKey(data.question)]: editFromQuestion(data.question) }));
      setStatusMessage("Question saved locally. Push it to Canvas after review.");
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save quiz question.");
    } finally {
      setSavingId(null);
    }
  };

  const addQuestion = async () => {
    setAdding(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/quiz-questions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: "<p>New question</p>",
          question_type: "multiple_choice_question",
          points_possible: 1,
          answers: [
            { text: "Option A", html: "Option A", weight: 100 },
            { text: "Option B", html: "Option B", weight: 0 },
            { text: "Option C", html: "Option C", weight: 0 },
            { text: "Option D", html: "Option D", weight: 0 },
          ],
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Unable to add quiz question."));
      const data = await res.json() as { question: QuizQuestion };
      setQuestions((previous) => [...previous, data.question].sort((a, b) => a.position - b.position));
      setEdits((previous) => ({ ...previous, [questionKey(data.question)]: editFromQuestion(data.question) }));
      setExpanded(true);
      setStatusMessage("Question added locally. Push it to Canvas after review.");
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add quiz question.");
    } finally {
      setAdding(false);
    }
  };

  const deleteQuestion = async (question: QuizQuestion) => {
    if (!window.confirm("Delete this quiz question? Existing Canvas questions will be removed when you push the quiz after review.")) return;
    const key = questionKey(question);
    setDeletingId(key);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${contentItemId}/quiz-questions/${questionKey(question)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Unable to delete quiz question."));
      setQuestions((previous) => previous.filter((row) => questionKey(row) !== key));
      const data = await res.json().catch(() => ({})) as { pending_delete?: boolean };
      setStatusMessage(data.pending_delete ? "Question marked for deletion. Push the quiz to Canvas after review." : "Question deleted locally.");
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete quiz question.");
    } finally {
      setDeletingId(null);
    }
  };

  const sortedQuestions = [...questions].sort((a, b) => a.position - b.position);
  const addDisabled = adding || Boolean(statusMessage && !questions.length);

  return (
    <Card as="section" className="mt-6 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          className="border-0 px-0 text-on-surface hover:bg-transparent"
          icon={expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        >
          Quiz Questions ({questions.length})
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={loadQuestions} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <Alert variant="error" className="mt-3 py-3">{error}</Alert> : null}
      {statusMessage ? <Alert variant="info" className="mt-3 py-3">{statusMessage}</Alert> : null}

      {expanded ? (
        <div className="mt-4 space-y-4">
          {loading ? <p className="text-sm text-on-surface-variant">Loading quiz questions...</p> : null}
          {!loading && !sortedQuestions.length && !statusMessage ? (
            <Alert variant="info" className="py-3">
              No editable classic quiz questions were found. The quiz may use a question bank, New Quizzes, or have no questions yet.
            </Alert>
          ) : null}
          {sortedQuestions.map((question, index) => {
            const editKey = questionKey(question);
            const edit = edits[editKey];
            const isEditing = editing && Boolean(edit);
            const currentType = edit?.question_type ?? question.question_type;
            const answers = edit?.answers ?? question.answers ?? [];
            const saving = savingId === editKey;
            const isDirty = Boolean(edit) && JSON.stringify(edit) !== JSON.stringify(editFromQuestion(question));

            return (
              <article key={questionKey(question)} className={`rounded-2xl border p-4 ${isEditing ? "border-primary/40 bg-primary/5" : "border-outline-variant/30 bg-surface-container-lowest"}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <select value={edit.question_type} onChange={(event) => changeQuestionType(editKey, event.target.value)} className="rounded-lg border border-outline-variant/40 bg-white px-3 py-2 text-xs font-semibold text-on-surface outline-none focus:border-primary">
                          {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                      ) : (
                        <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-[11px] font-semibold text-on-surface-variant">{typeLabel(currentType)}</span>
                      )}
                      {isEditing ? (
                        <label className="flex items-center gap-1 text-xs font-semibold text-on-surface-variant">
                          <Input type="number" value={edit.points_possible} min={0} step={0.5} disabled={currentType === "text_only_question"} onChange={(event) => updateEdit(editKey, { points_possible: Number(event.target.value) })} containerClassName="w-20" className="bg-white px-2 py-2 disabled:bg-surface-container-low disabled:text-on-surface-variant" />
                          pts
                        </label>
                      ) : (
                        <span className="text-xs font-semibold text-on-surface-variant">{question.points_possible} pt{question.points_possible === 1 ? "" : "s"}</span>
                      )}
                      {isEditing ? (
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveQuestion(question)}
                            disabled={saving || !isDirty}
                            loading={saving}
                            icon={<Save size={18} />}
                            className="h-8 px-3 text-xs [&_svg]:h-[18px] [&_svg]:w-[18px]"
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteQuestion(question)}
                            disabled={deletingId === questionKey(question)}
                            className="h-8 px-3 text-xs [&_svg]:h-[18px] [&_svg]:w-[18px]"
                            title="Delete question"
                            icon={deletingId === editKey ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      {isEditing ? (
                        <CompactRichTextField value={edit.question_text} allowLists onChange={(html) => updateEdit(editKey, { question_text: html })} />
                      ) : question.question_text ? (
                        <div className="canvas-content text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: question.question_text }} />
                      ) : (
                        <p className="text-sm italic text-on-surface-variant">No question text</p>
                      )}
                    </div>

                    {NO_ANSWER_TYPES.has(currentType) ? (
                      <div className="mt-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                        {currentType === "essay_question" ? "Students write a free-form response. Graded manually." : null}
                        {currentType === "file_upload_question" ? "Students upload a file. Graded manually." : null}
                        {currentType === "text_only_question" ? "Text-only items are saved with 0 points and no answer choices." : null}
                        {currentType === "calculated_question" ? "Calculated questions can be reviewed here, but full variable editing remains in Canvas." : null}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Answers</p>
                        {currentType === "multiple_dropdowns_question" || currentType === "fill_in_multiple_blanks_question" ? (
                          <p className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                            In the box above, every place you want to show an answer box, type a reference word with no spaces surrounded by brackets, such as: Roses are [color1], violets are [color2].
                          </p>
                        ) : null}
                        {answers.map((answer, answerIndex) => {
                          const correct = (answer.weight ?? answer.answer_weight ?? 0) > 0;
                          const isMultiple = currentType === "multiple_answers_question" || currentType === "multiple_dropdowns_question";
                          const showsCorrectToggle = !NO_CORRECT_TOGGLE_TYPES.has(currentType);
                          const visuallyCorrect = showsCorrectToggle && correct;
                          const answerHtml = answer.html || answer.answer_html || answer.text || answer.answer_text || "";
                          return (
                            <div key={answer.id ?? answerIndex} className={`overflow-hidden rounded-xl border ${visuallyCorrect ? "border-green-300 bg-green-50" : "border-outline-variant/30 bg-white"}`}>
                              {isEditing ? (
                                <>
                                  <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/20 bg-surface-container-low px-3 py-2">
                                    {showsCorrectToggle ? (
                                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleCorrect(editKey, answerIndex, isMultiple)} className={`h-8 px-2 text-xs [&_svg]:h-[16px] [&_svg]:w-[16px] ${correct ? "border-green-600 bg-green-600 text-white hover:bg-green-700" : "border-outline-variant bg-white text-on-surface-variant"}`}>
                                        {correct ? <Check size={16} /> : null}
                                        Correct
                                      </Button>
                                    ) : null}
                                    <span className="text-sm font-bold text-on-surface-variant">{String.fromCharCode(65 + answerIndex)}.</span>
                                    {currentType === "matching_question" ? (
                                      <>
                                        <Input value={matchingPrompt(answer)} onChange={(event) => updateAnswer(editKey, answerIndex, { answer_match_left: event.target.value, left: event.target.value, text: event.target.value })} containerClassName="min-w-[160px] flex-1" className="bg-white px-3 py-2" placeholder="Prompt" />
                                        <Input value={matchingMatch(answer)} onChange={(event) => updateAnswer(editKey, answerIndex, { answer_match_right: event.target.value, right: event.target.value })} containerClassName="min-w-[160px] flex-1" className="bg-white px-3 py-2" placeholder="Match" />
                                      </>
                                    ) : currentType === "numerical_question" ? (
                                      <div className="flex flex-1 flex-wrap items-center gap-2">
                                        <select value={answer.numerical_answer_type ?? "exact_answer"} onChange={(event) => updateAnswer(editKey, answerIndex, { numerical_answer_type: event.target.value })} className="rounded-lg border border-outline-variant/40 bg-white px-3 py-2 text-xs font-semibold text-on-surface outline-none focus:border-primary">
                                          <option value="exact_answer">Exact answer</option>
                                          <option value="range_answer">Answer in range</option>
                                          <option value="precision_answer">Answer with precision</option>
                                        </select>
                                        {(answer.numerical_answer_type ?? "exact_answer") === "range_answer" ? (
                                          <>
                                            <Input type="number" value={answer.start ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { start: Number(event.target.value), weight: 100 })} containerClassName="w-28" className="bg-white px-3 py-2" placeholder="Value 1" />
                                            <Input type="number" value={answer.end ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { end: Number(event.target.value), weight: 100 })} containerClassName="w-28" className="bg-white px-3 py-2" placeholder="Value 2" />
                                          </>
                                        ) : (answer.numerical_answer_type ?? "exact_answer") === "precision_answer" ? (
                                          <>
                                            <Input type="number" value={answer.approximate ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { approximate: Number(event.target.value), weight: 100 })} containerClassName="w-32" className="bg-white px-3 py-2" placeholder="Value" />
                                            <Input type="number" value={answer.precision ?? 1} min={1} max={16} onChange={(event) => updateAnswer(editKey, answerIndex, { precision: Number(event.target.value), weight: 100 })} containerClassName="w-28" className="bg-white px-3 py-2" placeholder="Precision" />
                                          </>
                                        ) : (
                                          <>
                                            <Input type="number" value={answer.exact ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { exact: Number(event.target.value), numerical_answer_type: "exact_answer", weight: 100 })} containerClassName="w-28" className="bg-white px-3 py-2" placeholder="Exact" />
                                            <Input type="number" value={answer.margin ?? 0} onChange={(event) => updateAnswer(editKey, answerIndex, { margin: Number(event.target.value), weight: 100 })} containerClassName="w-24" className="bg-white px-3 py-2" placeholder="+/-" />
                                          </>
                                        )}
                                      </div>
                                    ) : currentType === "short_answer_question" || currentType === "fill_in_multiple_blanks_question" || currentType === "multiple_dropdowns_question" ? (
                                      <>
                                        {currentType !== "short_answer_question" ? <Input value={answer.blank_id ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { blank_id: event.target.value })} containerClassName="w-32" className="bg-white px-3 py-2" placeholder="blank id" /> : null}
                                        <Input value={answer.text ?? ""} onChange={(event) => updateAnswer(editKey, answerIndex, { text: event.target.value, weight: currentType === "multiple_dropdowns_question" ? (answer.weight ?? 100) : 100 })} containerClassName="min-w-[180px] flex-1" className="bg-white px-3 py-2" placeholder={currentType === "multiple_dropdowns_question" ? "Dropdown answer" : "Answer"} />
                                      </>
                                    ) : (
                                      <span className="text-xs text-on-surface-variant">{correct ? "Correct" : "Incorrect"}</span>
                                    )}
                                    {currentType !== "true_false_question" ? (
                                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAnswer(editKey, answerIndex)} className="ml-auto h-8 border-0 px-2 text-xs text-on-surface-variant hover:bg-error/10 hover:text-error">
                                        Remove
                                      </Button>
                                    ) : null}
                                  </div>
                                  {["multiple_choice_question", "multiple_answers_question"].includes(currentType) ? (
                                    <CompactRichTextField value={answerHtml} minHeight={64} onChange={(html) => updateAnswer(editKey, answerIndex, { html, text: html })} />
                                  ) : null}
                                </>
                              ) : (
                                <div className="flex items-start gap-2 px-3 py-2 text-sm">
                                  <span className="font-bold text-on-surface-variant">{String.fromCharCode(65 + answerIndex)}.</span>
                                  {currentType === "matching_question" ? (
                                    <div className="min-w-0 flex-1 text-on-surface">
                                      <span>{matchingPrompt(answer) || "(blank)"}</span>
                                      <span className="mx-2 text-on-surface-variant">{"->"}</span>
                                      <span className="font-semibold">{matchingMatch(answer) || "(blank)"}</span>
                                    </div>
                                  ) : currentType === "numerical_question" ? (
                                    <div className="min-w-0 flex-1 text-on-surface">{numericalAnswerLabel(answer) || "(blank)"}</div>
                                  ) : (
                                    <div className="canvas-content min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: answerHtml || answer.left || answer.exact?.toString() || "<p>(blank)</p>" }} />
                                  )}
                                  {correct ? <Check size={18} className="mt-1 text-green-700" /> : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {isEditing && currentType !== "true_false_question" ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => addAnswer(editKey, currentType === "numerical_question" ? { exact: 0, margin: 0, numerical_answer_type: "exact_answer", weight: 100 } : currentType === "matching_question" ? { answer_match_left: "", answer_match_right: "", left: "", right: "", text: "" } : currentType === "multiple_dropdowns_question" ? { blank_id: "answer1", text: "", weight: 100 } : currentType === "fill_in_multiple_blanks_question" ? { blank_id: "answer1", text: "", weight: 100 } : {})} icon={<Plus size={18} />} className="w-full border-dashed border-outline-variant/50 text-on-surface-variant hover:border-primary hover:text-primary [&_svg]:h-[18px] [&_svg]:w-[18px]">
                            Add Answer
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {editing ? (
            <Button type="button" variant="ghost" onClick={addQuestion} disabled={addDisabled} loading={adding} icon={<Plus size={20} />} className="w-full border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 [&_svg]:h-5 [&_svg]:w-5">
              Add Question
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
