"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";

import { Alert, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export default function CreateModuleButton({ moduleCount, sessionId }: { moduleCount: number; sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createModule() {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/modules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          position: moduleCount + 1,
          published: true,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to create module"));
      }
      setOpen(false);
      setName("");
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create module");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="ghost"
        size="sm"
        icon={<FolderPlus size={14} />}
        className="border-outline-variant px-2.5 text-xs text-on-surface-variant"
      >
        Module
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="New Module"
        subtitle="Create"
        size="sm"
      >
        <ModalBody>
          <Input
            label="Module name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createModule();
              }
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Enter a module name"
            autoFocus
          />
          <p className="text-xs text-on-surface-variant">
            The module is added locally now and appears in Pending Review before it is created in Canvas.
          </p>
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
            disabled={!name.trim() || saving}
            loading={saving}
            onClick={() => void createModule()}
          >
            Create Module
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
