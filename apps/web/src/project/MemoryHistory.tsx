import type { Memory, Result } from "@apx/protocol";
import { Button } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

export function MemoryHistory({ note, onChanged }: { note: Memory; onChanged: () => void }) {
  const t = useT();
  const [versions, setVersions] = useState<Result<"memory.history">["versions"]>();
  const [open, setOpen] = useState(false);
  const load = async () => {
    try {
      setVersions((await client.call("memory.history", { id: note.id })).versions);
      setOpen(true);
    } catch (error) {
      notify(t("error.memory", { error: error instanceof Error ? error.message : String(error) }));
    }
  };
  const undo = async (revision: number) => {
    try {
      await client.call("memory.undo", { id: note.id, revision, expected_revision: note.revision });
      setOpen(false);
      onChanged();
    } catch (error) {
      notify(t("error.memory", { error: error instanceof Error ? error.message : String(error) }));
    }
  };
  return (
    <div className="memory__history">
      <Button size="sm" variant="ghost" onClick={() => (open ? setOpen(false) : void load())}>
        {t("memory.history")}
      </Button>
      {open && (
        <>
          {note.evidence?.map((e) => (
            <blockquote key={e.message_id + e.quote}>{e.quote}</blockquote>
          ))}
          <ul>
            {versions?.map((v) => (
              <li key={v.revision}>
                {t("memory.revision", { n: v.revision })} · {new Date(v.at).toLocaleString()} ·{" "}
                {t(
                  v.reason === "dream" || v.reason.startsWith("dream:")
                    ? "memory.reason.dream"
                    : v.reason === "undo"
                      ? "memory.reason.undo"
                      : v.reason === "capture-cleanup"
                        ? "memory.reason.cleanup"
                        : "memory.reason.saved",
                )}
                <p>{v.note.text}</p>
                {!note.forgotten_at && v.revision !== note.revision && (
                  <Button size="sm" variant="ghost" onClick={() => void undo(v.revision)}>
                    {t("memory.undo")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
