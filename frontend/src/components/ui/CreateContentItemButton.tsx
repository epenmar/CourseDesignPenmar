"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MessageSquare, Plus } from "lucide-react";

import { Alert, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type ContentType = "page" | "assignment" | "discussion";

type ModuleOption = {
  id: string;
  name: string;
};

type CreateResponse = {
  id: string;
};

function initialBodyForType(type: ContentType) {
  if (type === "assignment") return "<p>Assignment instructions go here.</p>";
  if (type === "discussion") return "<p>Discussion prompt goes here.</p>";
  return "<p>Page content goes here.</p>";
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

export default function CreateContentItemButton({
  modules,
  sessionId,
}: {
  modules: ModuleOption[];
  sessionId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contentType, setContentType] = useState<ContentType>("page");
  const [title, setTitle] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getAccessToken() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }

  async function createItem() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_type: contentType,
          title: title.trim(),
          html_body: initialBodyForType(contentType),
          module_id: moduleId || null,
          published,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to create content item"));
      }
      const data = await res.json() as CreateResponse;
      setOpen(false);
      setTitle("");
      setModuleId("");
      setPublished(false);
      router.push(`/sessions/${sessionId}/edit?item=${data.id}`);
      router.refresh();
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create content item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        size="sm"
        icon={<Plus size={14} />}
        className="text-xs"
      >
        Add
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="New Canvas Content"
        subtitle="Create"
      >
        <ModalBody>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["page", FileText, "Page"],
              ["assignment", FileText, "Assignment"],
              ["discussion", MessageSquare, "Discussion"],
            ] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setContentType(value)}
                className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold transition-colors ${
                  contentType === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-outline-variant/50 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>

          <Input
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Enter a title"
          />

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Module placement</span>
            <select
              value={moduleId}
              onChange={(event) => setModuleId(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option value="">Do not place in a module yet</option>
              {modules.map((module) => (
                <option key={module.id} value={module.id}>{module.name}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-on-surface-variant">
              Module placement is applied when the new item is pushed to Canvas.
            </span>
          </label>

          <label className="flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface">
            <input
              type="checkbox"
              checked={published}
              onChange={(event) => setPublished(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Publish when pushed to Canvas
          </label>

          {error ? (
            <Alert variant="error">
              {error}
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!title.trim() || saving}
            loading={saving}
            onClick={() => void createItem()}
          >
            Create Draft
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
