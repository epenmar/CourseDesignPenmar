"use client";

import { useEffect, useState } from "react";

type LiveQueueSearchProps = {
  containerId: string;
  initialQuery?: string;
  totalCount: number;
};

export default function LiveQueueSearch({ containerId, initialQuery = "", totalCount }: LiveQueueSearchProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const normalizedQuery = query.trim().toLowerCase();
    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-queue-item]"));
    let visibleCount = 0;

    for (const item of items) {
      const text = item.dataset.searchText?.toLowerCase() ?? "";
      const visible = !normalizedQuery || text.includes(normalizedQuery);
      item.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    const groups = Array.from(container.querySelectorAll<HTMLElement>("[data-queue-group]"));
    let visibleGroupCount = 0;
    for (const group of groups) {
      const visibleItems = Array.from(group.querySelectorAll<HTMLElement>("[data-queue-item]"))
        .some((item) => !item.hidden);
      const groupText = group.dataset.searchText?.toLowerCase() ?? "";
      const allowEmpty = group.dataset.allowEmpty === "true";
      const visibleEmptyGroup = allowEmpty && (!normalizedQuery || groupText.includes(normalizedQuery));
      group.hidden = !(visibleItems || visibleEmptyGroup);
      if (!group.hidden) visibleGroupCount += 1;
    }

    const count = container.querySelector<HTMLElement>("[data-queue-count]");
    if (count) {
      count.textContent = `${visibleCount} of ${totalCount} editable items`;
    }

    const empty = container.querySelector<HTMLElement>("[data-queue-empty]");
    if (empty) {
      empty.hidden = visibleCount !== 0 || visibleGroupCount !== 0;
    }

    const lists = Array.from(container.querySelectorAll<HTMLElement>("[data-queue-list]"));
    for (const list of lists) {
      list.hidden = visibleCount === 0 && visibleGroupCount === 0;
    }
  }, [containerId, query, totalCount]);

  return (
    <div className="border-b border-outline-variant/30 px-3 py-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Search queue..."
        className="w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
      />
    </div>
  );
}
