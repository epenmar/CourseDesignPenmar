"use client";

import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  }

  return (
    <main className="w-full max-w-md flex flex-col items-center gap-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-xl flex items-center justify-center btn-primary-gradient shadow-lg">
          <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="font-headline font-extrabold text-2xl tracking-tight text-primary">
            Canvas Curator
          </h1>
          <p className="text-xs uppercase tracking-[0.05em] text-secondary font-bold font-label mt-0.5">
            The Digital Curator
          </p>
        </div>
      </div>

      {/* Card */}
      <section className="w-full bg-surface-container-lowest rounded-xl p-10 flex flex-col gap-8 ghost-border shadow-ambient">
        <div className="text-center flex flex-col gap-3">
          <h2 className="font-headline text-2xl font-bold text-on-surface">
            Sign In
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Access your instructional design workflows and course curation tools
            in one centralized academic hub.
          </p>
        </div>

        {error && (
          <div className="bg-error-container text-on-error-container text-sm rounded-lg px-4 py-3">
            Authentication failed. Please try again.
          </div>
        )}

        <button
          onClick={signInWithGoogle}
          className="w-full btn-primary-gradient text-on-primary font-semibold py-3.5 px-6 rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-3 cursor-pointer"
        >
          <svg className="w-5 h-5 bg-white rounded-full p-0.5 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          <span>Sign in with Google</span>
        </button>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-surface-container-low rounded-xl flex flex-col gap-2">
            <span className="text-primary text-xl">⚡</span>
            <span className="text-xs font-bold text-on-surface uppercase tracking-wide">
              Automated Health
            </span>
          </div>
          <div className="p-4 bg-surface-container-low rounded-xl flex flex-col gap-2">
            <span className="text-primary text-xl">🔄</span>
            <span className="text-xs font-bold text-on-surface uppercase tracking-wide">
              LMS Sync
            </span>
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center gap-4 w-full">
        <div className="flex items-center gap-6">
          <span className="text-xs font-medium text-on-surface-variant">ASU Internal Tool</span>
          <span className="w-1 h-1 rounded-full bg-outline-variant opacity-50" />
          <span className="text-xs font-medium text-on-surface-variant">v2</span>
        </div>
      </footer>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="bg-surface min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background decorative blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[5%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-[5%] w-[30%] h-[30%] bg-secondary-container/10 rounded-full blur-[100px]" />
      </div>

      <Suspense>
        <LoginContent />
      </Suspense>
    </div>
  );
}
