import { useState } from "react";
import { Dialog, Button, Field, Input } from "../ui";
import { useToast } from "../Toast";
import { ProjectFiles, type FileScope } from "../../lib/api/projectFiles";
import { t } from "../../i18n";

// Create a new document. The user types a path (folders allowed, like
// Appsi's work/<case>/… layout); we default a .md extension when none is given.
export function NewFileDialog({
  open, onClose, pid, scope, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  pid: string;
  scope: FileScope;
  onCreated: (path: string) => void;
}) {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    let rel = path.trim().replace(/^\/+/, "");
    if (!rel) return;
    if (!/\.[a-z0-9]+$/i.test(rel)) rel += ".md";
    setSaving(true);
    try {
      await ProjectFiles.write(pid, rel, "", scope);
      toast.success(t("files.created"));
      setPath("");
      onCreated(rel);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("files.new_doc")}
      description={t("files.new_doc_hint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" data-testid="new-file-create" onClick={() => void create()} loading={saving} disabled={!path.trim()}>
            {t("files.create")}
          </Button>
        </>
      }
    >
      <Field label={t("files.path_label")} hint={t("files.path_example")}>
        <Input
          autoFocus
          data-testid="new-file-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="cases/onboarding/spec.md"
        />
      </Field>
    </Dialog>
  );
}
