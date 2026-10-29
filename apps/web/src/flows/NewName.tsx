// "New table" / "New column" right where it is needed: a button that opens a name field; Enter or Add makes it at once.

import { ApxError } from "@apx/protocol/client";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

export function NewName({
  label,
  field,
  placeholder,
  clean,
  create,
  open: startOpen = false,
  onCancel,
}: {
  /** The button, and what the field is named. */
  label: string;
  field: string;
  placeholder: string;
  /** The name as the core takes it, as people type. */
  clean: (typed: string) => string;
  /** Makes it; a refusal says why under the field. */
  create: (name: string) => Promise<unknown>;
  open?: boolean;
  onCancel?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => {
    setOpen(false);
    setName("");
    setError(undefined);
    onCancel?.();
  };
  const make = async () => {
    if (!name || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await create(name);
      setName("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApxError && e.code === "conflict" ? t("flow.tbl.taken") : t("flow.tbl.notMade"));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <Button size="sm" variant="ghost" leadingIcon={<Icons.Plus size={14} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="ft-new">
      <div className="ft-new__row">
        <Input
          size="sm"
          aria-label={field}
          autoFocus
          className="fe-mono"
          spellCheck={false}
          value={name}
          placeholder={placeholder}
          invalid={Boolean(error)}
          onChange={(e) => setName(clean(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void make();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        />
        <Button size="sm" variant="secondary" disabled={!name || busy} onClick={() => void make()}>
          {t("flow.tbl.add")}
        </Button>
        <Button size="sm" variant="ghost" onClick={close}>
          {t("common.cancel")}
        </Button>
      </div>
      {error && <span className="ft-new__error">{error}</span>}
    </div>
  );
}
