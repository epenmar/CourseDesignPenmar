"use client";

/**
 * Toolbar row for editor find/replace controls.
 */

import { ChevronDown, ChevronUp, X } from "lucide-react";

import { Button, Input } from "@/components/edplus";

type FindReplaceBarProps = {
  activeFindIndex: number;
  caseSensitive: boolean;
  findMatchCount: number;
  findQuery: string;
  onCaseSensitiveChange: (value: boolean) => void;
  onClose: () => void;
  onFindQueryChange: (value: string) => void;
  onReplaceActive: () => void;
  onReplaceAll: () => void;
  onReplaceValueChange: (value: string) => void;
  onStepMatch: (direction: 1 | -1) => void;
  replaceValue: string;
};

export function FindReplaceBar({
  activeFindIndex,
  caseSensitive,
  findMatchCount,
  findQuery,
  onCaseSensitiveChange,
  onClose,
  onFindQueryChange,
  onReplaceActive,
  onReplaceAll,
  onReplaceValueChange,
  onStepMatch,
  replaceValue,
}: FindReplaceBarProps) {
  const hasQuery = Boolean(findQuery.trim());
  const hasMatches = findMatchCount > 0;

  return (
    <div className="flex-none border-b border-outline-variant/20 bg-surface-container-low px-6 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Find"
          type="text"
          value={findQuery}
          onChange={(event) => onFindQueryChange(event.target.value)}
          className="h-10 bg-white py-2 normal-case tracking-normal"
          containerClassName="min-w-[220px] flex-1"
          placeholder="Text in this item"
          autoFocus
        />
        <Input
          label="Replace"
          type="text"
          value={replaceValue}
          onChange={(event) => onReplaceValueChange(event.target.value)}
          className="h-10 bg-white py-2 normal-case tracking-normal"
          containerClassName="min-w-[220px] flex-1"
          placeholder="Replacement text"
        />
        <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-outline-variant/40 bg-white px-3 text-xs font-semibold text-on-surface-variant">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => onCaseSensitiveChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Match case
        </label>
        <span className="inline-flex h-10 items-center rounded-xl bg-surface-container-high px-3 text-xs font-semibold text-on-surface-variant">
          {hasQuery ? (hasMatches ? `${activeFindIndex + 1} of ${findMatchCount}` : "0 matches") : "No query"}
        </span>
        <div className="flex h-10 items-center gap-1 rounded-xl border border-outline-variant/40 bg-white p-1">
          <Button
            type="button"
            title="Previous match"
            disabled={!hasMatches}
            onClick={() => onStepMatch(-1)}
            variant="ghost"
            size="sm"
            icon={<ChevronUp size={22} strokeWidth={2.4} />}
            className="h-9 w-9 border-0 p-0 text-on-surface-variant"
          >
            <span className="sr-only">Previous match</span>
          </Button>
          <Button
            type="button"
            title="Next match"
            disabled={!hasMatches}
            onClick={() => onStepMatch(1)}
            variant="ghost"
            size="sm"
            icon={<ChevronDown size={22} strokeWidth={2.4} />}
            className="h-9 w-9 border-0 p-0 text-on-surface-variant"
          >
            <span className="sr-only">Next match</span>
          </Button>
        </div>
        <Button
          type="button"
          disabled={!hasQuery || !hasMatches}
          variant="secondary"
          size="md"
          onClick={onReplaceActive}
          className="text-xs"
        >
          Replace
        </Button>
        <Button
          type="button"
          disabled={!hasQuery || !hasMatches}
          size="md"
          onClick={onReplaceAll}
          className="text-xs"
        >
          Replace All
        </Button>
        <Button
          type="button"
          title="Close find and replace"
          onClick={onClose}
          variant="ghost"
          size="md"
          icon={<X size={28} strokeWidth={2.8} />}
          className="h-10 w-10 p-0 text-on-surface-variant"
        >
          <span className="sr-only">Close find and replace</span>
        </Button>
      </div>
    </div>
  );
}
