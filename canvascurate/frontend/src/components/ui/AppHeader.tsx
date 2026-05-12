"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function UserAvatar({
  email,
  avatarUrl,
  isSystemAdmin,
}: {
  email: string | null;
  avatarUrl: string | null;
  isSystemAdmin?: boolean;
}) {
  const initials = email ? email[0].toUpperCase() : "?";
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={email ?? "User"}
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full object-cover ring-2 ring-primary/20 ring-offset-2"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary ring-2 ring-primary/20 ring-offset-2">
            {initials}
          </div>
        )}
        <span className="max-w-56 truncate text-sm font-medium text-on-surface-variant">{email}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 shadow-card"
        >
          <div className="px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant">Signed in</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-on-surface">{email}</p>
          </div>
          {isSystemAdmin ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/admin");
              }}
              className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            >
              System diagnostics
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AppHeader({
  email,
  avatarUrl,
  sessionName,
  isSystemAdmin,
}: {
  email: string | null;
  avatarUrl: string | null;
  sessionName?: string | null;
  isSystemAdmin?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex w-full items-center justify-between gap-4 border-b border-outline-variant glass px-8 py-3">
      <div className="flex min-w-0 items-center gap-4">
        {sessionName ? (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">Course</p>
            <p className="truncate text-sm font-bold text-on-surface">{sessionName}</p>
          </div>
        ) : null}
      </div>
      <UserAvatar email={email} avatarUrl={avatarUrl} isSystemAdmin={isSystemAdmin} />
    </header>
  );
}
