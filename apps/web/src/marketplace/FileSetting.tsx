import { Button, Field } from "@apx/ui";
import { useEffect, useId, useState } from "react";
import { useT } from "../i18n/index.ts";

export function FileSetting({
  label,
  description,
  value,
  sqlite,
  error,
  onChange,
}: {
  label: string;
  description?: string;
  value?: string;
  sqlite: boolean;
  error?: string;
  onChange(file: string): void;
}) {
  const t = useT();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void window.apxDesktop
      ?.canPickFile?.()
      .then((ok) => {
        if (live) setAvailable(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const pick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const file = await window.apxDesktop?.pickFile?.();
      if (file) onChange(file);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const name = value?.split(/[\\/]/).pop();
  const feedback = useId();
  const problem = error || (failed ? t("mkt.filePickerFailed") : undefined);
  const action = t(
    sqlite ? (value ? "mkt.changeBackup" : "mkt.chooseBackup") : value ? "mkt.changeFile" : "mkt.chooseFile",
  );
  return (
    <Field
      label={label}
      hint={description && <span id={feedback}>{description}</span>}
      error={
        problem && (
          <span id={feedback} role="alert">
            {problem}
          </span>
        )
      }
    >
      {(id) => (
        <div className="mkt-file">
          {name && <span className="mkt-file__name">{name}</span>}
          {available ? (
            <Button
              id={id}
              aria-label={`${label}: ${action}`}
              variant="secondary"
              size="sm"
              loading={busy}
              aria-describedby={description || problem ? feedback : undefined}
              aria-invalid={Boolean(problem)}
              onClick={() => void pick()}
            >
              {action}
            </Button>
          ) : (
            <p id={id} className="mkt-file__handoff">
              {t("mkt.fileHostOnly")}
            </p>
          )}
        </div>
      )}
    </Field>
  );
}
