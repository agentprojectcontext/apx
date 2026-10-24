import type { Result } from "@apx/protocol";
import { Button, EmptyState, Icons, MarkdownView, SegmentedControl, Skeleton } from "@apx/ui";
import { Suspense, useEffect, useState } from "react";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { client } from "../../data/client.ts";
import { downloadFile, type FileWhere } from "../../data/files.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { CodeView } from "../../lazy.ts";
import { FileHead } from "./FileHead.tsx";
import { errText, whereKey } from "./FilesPane.tsx";

type Read = Result<"files.read">;
type Mode = "view" | "source" | "split";
const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);

/**
 * A text file: its code with line numbers and colors (Markdown also read as a page, or both side by side). "Edit" makes
 * it editable; saving is refused when the file changed since it opened (an agent may be working on it too).
 */
export function TextView({ where, path }: { where: FileWhere; path: string }) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
  const [file, setFile] = useState<Read>();
  const [error, setError] = useState<string>();
  const md = isMarkdown(path);
  const [mode, setMode] = useState<Mode>(md ? "view" : "source");
  /** The text being edited; undefined while only reading. */
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** Bumped to rebuild the editor from the file again (after a save or a discard). */
  const [round, setRound] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope object is new each render; its key is what changes.
  useEffect(() => {
    let live = true;
    client.call("files.read", { ...where, path }).then(
      (f) => live && setFile(f),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [whereKey(where), path]);

  const editing = draft !== undefined;
  const changed = editing && draft !== file?.text;
  const canEdit = Boolean(file && !file.binary && !file.truncated && file.text != null);
  const edit = () => {
    setDraft(file?.text ?? "");
    // Markdown is edited as source, with the page beside it.
    if (mode === "view") setMode("split");
  };
  const discard = () => {
    setDraft(undefined);
    setRound((n) => n + 1);
  };
  const save = async () => {
    if (!file || draft === undefined || saving) return;
    setSaving(true);
    try {
      const r = await client.call("files.write", {
        ...where,
        path,
        text: draft,
        ...(file.version ? { version: file.version } : {}),
      });
      setFile({ ...file, text: draft, bytes: r.bytes, version: r.version });
      setDraft(undefined);
      setRound((n) => n + 1);
      notify(t("files.saved", { path }), "info");
    } catch (e) {
      notify(t("files.saveFailed", { error: errText(e) }));
    }
    setSaving(false);
  };

  return (
    <>
      <FileHead where={where} path={path} {...(file ? { size: file.bytes } : {})}>
        {md && file?.text != null && (
          <SegmentedControl
            size="sm"
            label={t("files.mode")}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            options={[
              { value: "view", label: t("files.mode.view") },
              { value: "source", label: t("files.mode.source") },
              { value: "split", label: t("files.mode.split") },
            ]}
          />
        )}
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={discard}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!changed}
              loading={saving}
              leadingIcon={<Icons.Check size={14} />}
              onClick={() => void save()}
            >
              {t("files.save")}
            </Button>
          </>
        ) : (
          canEdit && (
            <Button size="sm" variant="ghost" leadingIcon={<Icons.Pencil size={14} />} onClick={edit}>
              {t("files.edit")}
            </Button>
          )
        )}
      </FileHead>
      {error ? (
        <p className="files__error">{error}</p>
      ) : !file ? (
        <Skeleton height={200} />
      ) : file.binary ? (
        <EmptyState icon={<Icons.File />} title={t("files.binary")}>
          {t("files.binaryBody")}
          <Button size="sm" variant="secondary" onClick={() => void downloadFile(where, path)}>
            {t("files.download")}
          </Button>
        </EmptyState>
      ) : (
        <div className={`files__body is-${md ? mode : "source"}${editing ? " is-editing" : ""}`}>
          {(!md || mode !== "view") && (
            <Suspense fallback={<pre className="files__source">{file.text}</pre>}>
              <CodeView
                key={round}
                path={path}
                text={file.text ?? ""}
                editable={editing}
                onChange={setDraft}
                onSave={() => void save()}
              />
            </Suspense>
          )}
          {md && mode !== "source" && (
            <div className="files__md">
              <MarkdownView source={draft ?? file.text ?? ""} labels={mdLabels} />
            </div>
          )}
          {file.truncated && <p className="files__more">{t("files.truncated")}</p>}
        </div>
      )}
    </>
  );
}
