import { Button, IconButton, Icons, Input, Popover, SearchField } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { listSecrets } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { toVarName, VariableDialog } from "./VariablesTab.tsx";

export type Pair = { key: string; value: string };

/** Rows of a definition's environment (or an endpoint's headers) back to the object the core stores. */
export const pairsToRecord = (pairs: readonly Pair[]) =>
  Object.fromEntries(pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value.trim()]));

/**
 * Key/value rows; a value can hold the owner's Variables (`secret://NAME`, picked from a list or created on the spot),
 * alone or within text, so a secret is never typed into the definition. Environment keys are written as env names.
 */
export function PairsEditor(props: {
  pairs: Pair[];
  onChange(pairs: Pair[]): void;
  /** `env`: keys become upper case with underscores; `headers`: keys as typed (`Authorization`). */
  keys: "env" | "headers";
  label: string;
}) {
  const t = useT();
  const { pairs, onChange } = props;
  const rows = pairs.length ? pairs : [{ key: "", value: "" }];
  const values = useRef<Array<HTMLInputElement | null>>([]);
  const set = (i: number, p: Partial<Pair>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  /** A variable goes where the cursor was in the value (or replaces what was selected), next to any text. */
  const insert = (i: number, name: string) => {
    const input = values.current[i];
    const value = rows[i]?.value ?? "";
    const from = input?.selectionStart ?? value.length;
    const to = input?.selectionEnd ?? from;
    const ref = `secret://${name}`;
    set(i, { value: value.slice(0, from) + ref + value.slice(to) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(from + ref.length, from + ref.length);
    });
  };
  return (
    <fieldset className="pairs" aria-label={props.label}>
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own while they are typed
        <div key={i} className="pairs__row">
          <Input
            aria-label={t("res.pairKey")}
            className="pairs__key resd__monoinput"
            value={r.key}
            placeholder={props.keys === "env" ? "API_KEY" : "Authorization"}
            onChange={(e) =>
              set(i, { key: props.keys === "env" ? toVarName(e.currentTarget.value) : e.currentTarget.value })
            }
          />
          <Input
            ref={(el) => {
              values.current[i] = el;
            }}
            aria-label={t("res.pairValue")}
            className={`pairs__value${/^secret:\/\/[\w.-]+$/.test(r.value) ? " is-var" : ""}`}
            value={r.value}
            placeholder={t("res.pairValueHint")}
            onChange={(e) => set(i, { value: e.currentTarget.value })}
          />
          <VarPicker onPick={(name) => insert(i, name)} />
          <IconButton
            size="sm"
            label={t("res.pairRemove")}
            icon={<Icons.Trash2 size={14} />}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Icons.Plus size={14} />}
          onClick={() => onChange([...rows, { key: "", value: "" }])}
        >
          {t("res.pairAdd")}
        </Button>
      </div>
    </fieldset>
  );
}

/** "+": the owner's Variables to pick one from, and "New variable…" to store one and use it at once. */
function VarPicker({ onPick }: { onPick(name: string): void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [names, setNames] = useState<string[]>();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    setQ("");
    void listSecrets().then((s) =>
      setNames([...new Set((s ?? []).filter((x) => !x.project_id).map((x) => x.name))].sort()),
    );
  }, [open]);
  const shown = useMemo(
    () => (names ?? []).filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())),
    [names, q],
  );
  const pick = (name: string) => {
    setOpen(false);
    onPick(name);
  };
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={280}
        align="end"
        label={t("res.pairInsertVar")}
        trigger={<IconButton size="sm" label={t("res.pairInsertVar")} icon={<Icons.Plus size={14} />} />}
      >
        <div className="varpick">
          <SearchField
            size="sm"
            autoFocus
            placeholder={t("res.pairSearchVar")}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          <div className="varpick__list" role="listbox" aria-label={t("res.pairInsertVar")}>
            {names && !shown.length && <p className="varpick__empty">{t("res.noMatch")}</p>}
            {shown.map((n) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={false}
                className="varpick__item"
                onClick={() => pick(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="varpick__new"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Icons.Plus size={13} /> {t("res.pairNewVar")}
          </button>
        </div>
      </Popover>
      {creating && (
        <VariableDialog
          row={undefined}
          projectId={undefined}
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            onPick(name);
          }}
        />
      )}
    </>
  );
}
