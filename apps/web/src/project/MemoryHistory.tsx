import type { Memory, Result } from "@apx/protocol";
import { Button } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A note's sources (the words it was learned from) and its earlier revisions, each one restorable. */
export function MemoryHistory({ note, onChanged }: { note: Memory; onChanged: () => void }) {
  const t = useT();
  const [versions, setVersions] = useState<Result<"memory.history">["versions"]>();
  // Read again when the note changes (an edit, a restored revision).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is what makes its history change
  useEffect(() => {
    let live = true;
    client
      .call("memory.history", { id: note.id })
      .then((r) => live && setVersions(r.versions))
      .catch((error: unknown) => live && notify(t("error.memory", { error: errText(error) })));
    return () => {
      live = false;
    };
  }, [note.id, note.revision, t]);
  const undo = async (revision: number) => {
    try {
      await client.call("memory.undo", { id: note.id, revision, expected_revision: note.revision });
      onChanged();
    } catch (error) {
      notify(t("error.memory", { error: errText(error) }));
    }
  };
  // The current revision is the text shown above it.
  const earlier = versions?.filter((v) => v.revision !== note.revision) ?? [];
  if (!note.evidence?.length && !earlier.length) return null;
  return (
    <section className="memory__history" aria-label={t("memory.history")}>
      <h3 className="memnote__h">{t("memory.history")}</h3>
      {note.evidence?.map((e) => (
        <blockquote key={e.message_id + e.quote}>{e.quote}</blockquote>
      ))}
      <ul>
        {earlier.map((v) => (
          <li key={v.revision}>
            <span className="memory__version">
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
            </span>
            <p>{v.note.text}</p>
            {!note.forgotten_at && (
              <Button size="sm" variant="ghost" onClick={() => void undo(v.revision)}>
                {t("memory.undo")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
