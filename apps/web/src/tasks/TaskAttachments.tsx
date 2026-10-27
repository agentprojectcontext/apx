import type { Task } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { Suspense, useEffect, useRef, useState } from "react";
import { FilePart } from "../chat/parts/FilePart.tsx";
import { client } from "../data/client.ts";
import { type Attached, upload } from "../data/composer.ts";
import { useT } from "../i18n/index.ts";
import { MediaGroup } from "../lazy.ts";
import { cleanupTaskUpload, discardTaskUpload } from "./draftAttachments.ts";
import "./attachments.css";

export function TaskAttachments({
  value,
  onChange,
  task,
  onBusy,
  disabled = false,
}: {
  value: Attached[];
  onChange: (value: Attached[]) => void;
  task?: Task;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const limit = task ? 50 : 20;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const working = (next: boolean) => {
    if (!mounted.current) return;
    setBusy(next);
    onBusy?.(next);
  };
  const add = async (files: File[]) => {
    if (busy || disabled || !files.length) return;
    if (value.length + files.length > limit) {
      setError(t("tasks.attachments.limit", { count: limit }));
      return;
    }
    working(true);
    setError("");
    let next = value;
    try {
      for (const file of files) {
        if (!mounted.current) break;
        const media = await upload(file, undefined, { taskAsset: true });
        if (!mounted.current) {
          cleanupTaskUpload(media.id);
          break;
        }
        if (task) {
          try {
            const result = await client.call("tasks.attach", { task: task.id, media_ids: [media.id] });
            next = result.attachments.map((a) => ({ ...a, id: a.media_id }));
          } catch (error) {
            cleanupTaskUpload(media.id);
            throw error;
          }
        } else next = [...next, media];
        if (mounted.current) onChange(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working(false);
    }
  };
  const remove = async (id: string) => {
    if (busy || disabled) return;
    working(true);
    setError("");
    try {
      if (task) await client.call("tasks.detach", { task: task.id, media_id: id });
      else await discardTaskUpload(id);
      onChange(value.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working(false);
    }
  };
  return (
    <section className="taskattachments" aria-label={t("tasks.attachments")} aria-busy={busy}>
      <div className="taskattachments__header">
        <span>{t("tasks.attachments")}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || disabled || value.length >= limit}
          onClick={() => input.current?.click()}
          leadingIcon={<Icons.Paperclip size={14} />}
        >
          {t(busy ? "tasks.attachments.uploading" : "tasks.attachments.add")}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={t("tasks.attachments.add")}
          disabled={busy || disabled}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            void add(files);
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {value.map((a) => (
        <div className="taskattachments__item" key={a.id}>
          <div className="taskattachments__asset">
            {a.kind === "image" && (
              <Suspense fallback={null}>
                <MediaGroup
                  block={{ kind: "images", key: a.id, parts: [{ type: "image", media_id: a.id, alt: a.name }] }}
                />
              </Suspense>
            )}
            <FilePart part={{ type: "file", media_id: a.id, name: a.name, mime: a.mime, bytes: a.bytes }} />
          </div>
          <IconButton
            size="sm"
            disabled={busy || disabled}
            label={t("tasks.attachments.remove", { name: a.name })}
            icon={<Icons.X size={14} />}
            onClick={() => void remove(a.id)}
          />
        </div>
      ))}
    </section>
  );
}
