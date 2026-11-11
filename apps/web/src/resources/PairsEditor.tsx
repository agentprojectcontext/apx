import { Button, IconButton, Icons, Input } from "@apx/ui";
import { useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { VarField, type VarFieldHandle } from "./VarField.tsx";
import { toVarName } from "./VariableDialog.tsx";
import { VariablePicker } from "./VariablePicker.tsx";

export type Pair = { key: string; value: string };

/** Rows of a definition's environment (or an endpoint's headers) back to the object the core stores. */
export const pairsToRecord = (pairs: readonly Pair[]) =>
  Object.fromEntries(pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value.trim()]));

export function PairsEditor(props: {
  pairs: Pair[];
  onChange(pairs: Pair[]): void;
  keys: "env" | "headers";
  label: string;
  vars?: boolean;
  project?: string | undefined;
}) {
  const t = useT();
  const { pairs, onChange } = props;
  const rows = pairs.length ? pairs : [{ key: "", value: "" }];
  const fields = useRef<Array<VarFieldHandle | null>>([]);
  const [requests, setRequests] = useState<Record<number, number>>({});
  const set = (i: number, p: Partial<Pair>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <fieldset className="pairs" aria-label={props.label}>
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own while they are typed
        <div key={i} className="pairs__row">
          <Input
            aria-label={`${t("res.pairKey")} ${i + 1}`}
            className="pairs__key resd__monoinput"
            value={r.key}
            placeholder={props.keys === "env" ? "API_KEY" : "Authorization"}
            onChange={(e) =>
              set(i, { key: props.keys === "env" ? toVarName(e.currentTarget.value) : e.currentTarget.value })
            }
          />
          {props.vars === false ? (
            <Input
              aria-label={`${t("res.pairValue")} ${r.key || i + 1}`}
              className="pairs__value"
              value={r.value}
              placeholder={t("res.pairValuePlain")}
              onChange={(e) => set(i, { value: e.currentTarget.value })}
            />
          ) : (
            <VarField
              ref={(h) => {
                fields.current[i] = h;
              }}
              label={`${t("res.pairValue")} ${r.key || i + 1}`}
              removeLabel={t("res.pairRemoveVar")}
              placeholder={t("res.pairValueHint")}
              value={r.value}
              onSuggest={() => setRequests((s) => ({ ...s, [i]: (s[i] ?? 0) + 1 }))}
              onChange={(value) => set(i, { value })}
            />
          )}
          {props.vars !== false && (
            <VariablePicker
              project={props.project}
              rowLabel={r.key || String(i + 1)}
              request={requests[i] ?? 0}
              onPick={(name) => fields.current[i]?.insert(name)}
            />
          )}
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
