"use client";

/**
 * Local find/replace state and editor selection behavior for the content editor.
 */

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";

import {
  clearFindHighlights,
  collectFindRanges,
  countEditorDocumentMatches,
  ensureFindHighlightStyles,
  findStringMatches,
  replaceNthTextMatchInHtml,
  replaceTextMatchesInHtml,
} from "@/modules/editor/utils/findReplace";
import { serializeHtmlBlocks } from "@/modules/editor/utils/html";

type EditorMode = "rich" | "html";

type UseEditorFindReplaceParams = {
  currentHtml: string;
  editor: Editor | null;
  editorMode: EditorMode;
  findReplaceOpen: boolean;
  htmlTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onHtmlChange: (html: string) => void;
  onMessage: (message: string) => void;
  onReplaceAllComplete: () => void;
  richEditorWrapperRef: RefObject<HTMLDivElement | null>;
};

export function useEditorFindReplace({
  currentHtml,
  editor,
  editorMode,
  findReplaceOpen,
  htmlTextareaRef,
  onHtmlChange,
  onMessage,
  onReplaceAllComplete,
  richEditorWrapperRef,
}: UseEditorFindReplaceParams) {
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [richFindMatchCount, setRichFindMatchCount] = useState(0);

  const htmlFindMatches = useMemo(
    () => (editorMode === "html" ? findStringMatches(currentHtml, findQuery, findCaseSensitive) : []),
    [currentHtml, editorMode, findCaseSensitive, findQuery],
  );
  const findMatchCount = editorMode === "rich" ? richFindMatchCount : htmlFindMatches.length;

  const selectFindMatch = useCallback(
    (index: number) => {
      if (editorMode === "rich") {
        const ranges = collectFindRanges(richEditorWrapperRef.current ?? editor?.view.dom ?? document.body, findQuery, findCaseSensitive);
        const range = ranges[index];
        const element = range?.startContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const match = htmlFindMatches[index];
      if (!match) return;
      focusHtmlRange(htmlTextareaRef.current, currentHtml, match.from, match.to);
    },
    [currentHtml, editor, editorMode, findCaseSensitive, findQuery, htmlFindMatches, htmlTextareaRef, richEditorWrapperRef],
  );

  useEffect(() => {
    setActiveFindIndex(0);
  }, [editorMode, findCaseSensitive, findQuery]);

  useEffect(() => {
    if (editorMode !== "rich") {
      setRichFindMatchCount(0);
      clearFindHighlights();
      return;
    }
    if (!findReplaceOpen || !findQuery.trim()) {
      setRichFindMatchCount(0);
      clearFindHighlights();
      return;
    }
    const root = richEditorWrapperRef.current ?? editor?.view.dom;
    const ranges = root ? collectFindRanges(root, findQuery, findCaseSensitive) : [];
    const fallbackCount = ranges.length ? ranges.length : countEditorDocumentMatches(editor, findQuery, findCaseSensitive);
    setRichFindMatchCount(fallbackCount);

    if (!root || typeof Highlight === "undefined" || typeof CSS === "undefined" || !("highlights" in CSS)) {
      clearFindHighlights();
      return;
    }
    ensureFindHighlightStyles();
    const activeRange = ranges[Math.min(activeFindIndex, Math.max(ranges.length - 1, 0))];
    const highlights = (CSS as typeof CSS & { highlights: HighlightRegistry }).highlights;
    highlights.set("canvas-curate-find-match", new Highlight(...ranges));
    highlights.set("canvas-curate-find-active", activeRange ? new Highlight(activeRange) : new Highlight());
    return clearFindHighlights;
  }, [activeFindIndex, currentHtml, editor, editorMode, findCaseSensitive, findQuery, findReplaceOpen, richEditorWrapperRef]);

  useEffect(() => {
    if (!findReplaceOpen || findMatchCount === 0) return;
    if (activeFindIndex >= findMatchCount) {
      setActiveFindIndex(findMatchCount - 1);
    }
  }, [activeFindIndex, findMatchCount, findReplaceOpen]);

  const stepFindMatch = useCallback(
    (direction: 1 | -1) => {
      if (findMatchCount === 0) return;
      const nextIndex = (activeFindIndex + direction + findMatchCount) % findMatchCount;
      setActiveFindIndex(nextIndex);
      selectFindMatch(nextIndex);
    },
    [activeFindIndex, findMatchCount, selectFindMatch],
  );

  const replaceActiveFindMatch = useCallback(() => {
    if (findMatchCount === 0) {
      onMessage("No selected match to replace.");
      return;
    }
    if (editorMode === "rich") {
      const sourceHtml = serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
      const result = replaceNthTextMatchInHtml(sourceHtml, findQuery, replaceValue, findCaseSensitive, activeFindIndex);
      if (!result.replaced) {
        onMessage("No selected match to replace.");
        return;
      }
      onHtmlChange(result.html);
      editor?.commands.setContent(result.html, { emitUpdate: false });
    } else {
      const match = htmlFindMatches[activeFindIndex];
      if (!match) {
        onMessage("No selected match to replace.");
        return;
      }
      const nextHtml = `${currentHtml.slice(0, match.from)}${replaceValue}${currentHtml.slice(match.to)}`;
      onHtmlChange(nextHtml);
      window.setTimeout(() => {
        const cursor = match.from + replaceValue.length;
        focusHtmlRange(htmlTextareaRef.current, nextHtml, cursor, cursor);
      }, 0);
    }
    onMessage("Replaced the selected match.");
  }, [
    activeFindIndex,
    currentHtml,
    editor,
    editorMode,
    findCaseSensitive,
    findMatchCount,
    findQuery,
    htmlFindMatches,
    htmlTextareaRef,
    onHtmlChange,
    onMessage,
    replaceValue,
  ]);

  const replaceCurrentItemMatches = useCallback(() => {
    const sourceHtml = editorMode === "html" ? currentHtml : serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
    const result = replaceTextMatchesInHtml(sourceHtml, findQuery, replaceValue, findCaseSensitive);
    if (result.count === 0) {
      onMessage("No matches found in the current item.");
      return;
    }
    onHtmlChange(result.html);
    if (editor) {
      editor.commands.setContent(result.html, { emitUpdate: false });
    }
    onReplaceAllComplete();
    onMessage(`Replaced ${result.count} match${result.count === 1 ? "" : "es"} in the current item.`);
  }, [currentHtml, editor, editorMode, findCaseSensitive, findQuery, onHtmlChange, onMessage, onReplaceAllComplete, replaceValue]);

  return {
    activeFindIndex,
    findCaseSensitive,
    findMatchCount,
    findQuery,
    replaceActiveFindMatch,
    replaceCurrentItemMatches,
    replaceValue,
    setFindCaseSensitive,
    setFindQuery,
    setReplaceValue,
    stepFindMatch,
  };
}

function focusHtmlRange(
  textarea: HTMLTextAreaElement | null,
  value: string,
  from: number,
  to: number,
) {
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(from, to);
  scrollTextareaToOffset(textarea, value, from);
  textarea.scrollIntoView({ block: "nearest" });
}

function scrollTextareaToOffset(textarea: HTMLTextAreaElement, value: string, offset: number) {
  const markerTop = measureTextareaOffsetTop(textarea, value, offset);
  if (markerTop === null) return;
  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  const targetScrollTop = markerTop - textarea.clientHeight / 2;
  textarea.scrollTop = Math.min(maxScrollTop, Math.max(0, targetScrollTop));
}

function measureTextareaOffsetTop(
  textarea: HTMLTextAreaElement,
  value: string,
  offset: number,
) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.boxSizing = "border-box";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = computed.wordBreak;
  mirror.style.fontFamily = computed.fontFamily;
  mirror.style.fontSize = computed.fontSize;
  mirror.style.fontStyle = computed.fontStyle;
  mirror.style.fontWeight = computed.fontWeight;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.padding = computed.padding;
  mirror.style.textTransform = computed.textTransform;

  marker.textContent = "\u200b";
  mirror.append(document.createTextNode(value.slice(0, offset)));
  mirror.append(marker);
  mirror.append(document.createTextNode(value.slice(offset)));
  document.body.append(mirror);

  const markerTop = marker.offsetTop;
  mirror.remove();
  return Number.isFinite(markerTop) ? markerTop : null;
}
