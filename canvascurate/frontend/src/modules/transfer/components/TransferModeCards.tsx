/**
 * Transfer mode selection cards based on the Phase 6 Transfer design target.
 */

import { Copy, Target, Upload } from "lucide-react";
import type { TransferMode, TransferModeOption } from "../types";

const modeIcons = {
  same_course: Upload,
  target_course: Target,
  copy_course: Copy,
};

export default function TransferModeCards({
  modes,
  selectedMode,
  onSelectMode,
}: {
  modes: TransferModeOption[];
  selectedMode: TransferMode | null;
  onSelectMode: (mode: TransferMode) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {modes.map((mode) => {
        const Icon = modeIcons[mode.mode];
        const selected = selectedMode === mode.mode;
        return (
          <button
            key={mode.mode}
            type="button"
            onClick={() => mode.enabled && onSelectMode(mode.mode)}
            disabled={!mode.enabled}
            className={`relative min-h-[210px] rounded-xl bg-surface-container-lowest p-6 text-left transition-all ghost-border ${
              selected ? "border-primary shadow-xl shadow-primary/5" : "hover:border-primary/40"
            } ${mode.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
          >
            {mode.recommended ? (
              <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-on-primary">
                Recommended
              </span>
            ) : null}
            <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-lg ${
              selected ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
            }`}>
              <Icon size={26} />
            </div>
            <h3 className="font-headline text-lg font-bold text-on-surface">{mode.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{mode.description}</p>
            <p className="mt-5 text-xs font-bold text-primary">
              {mode.enabled ? (selected ? "Selected" : "Configure") : mode.disabled_reason}
            </p>
          </button>
        );
      })}
    </section>
  );
}

