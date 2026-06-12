import { Plus, Trash2 } from "lucide-react";
import { Button, Input } from "../ui";
import { VarTokenInput } from "./VarTokenInput";

// Editable list of {key,value} pairs. Used for MCP env (stdio) and headers
// (http). Values are run through VarTokenInput so `${var.X}` references
// render as inline badges and can be inserted via the picker.

export interface KvRow {
  key: string;
  value: string;
}

export function rowsFromRecord(rec?: Record<string, string> | null): KvRow[] {
  if (!rec) return [];
  return Object.entries(rec).map(([key, value]) => ({ key, value: String(value) }));
}

export function recordFromRows(rows: KvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!r.key.trim()) continue;
    out[r.key.trim()] = r.value;
  }
  return out;
}

interface KeyValueListProps {
  rows: KvRow[];
  onChange: (next: KvRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  varNames?: string[];
  onCreateVar?: () => void;
  emptyLabel?: string;
}

export function KeyValueList({
  rows,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  varNames,
  onCreateVar,
  emptyLabel,
}: KeyValueListProps) {
  const update = (i: number, patch: Partial<KvRow>) => {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, { key: "", value: "" }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 && emptyLabel && (
        <p className="text-[11px] text-muted-foreground">{emptyLabel}</p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className="w-40 font-mono text-xs"
          />
          <div className="flex-1">
            <VarTokenInput
              value={row.value}
              onChange={(v) => update(i, { value: v })}
              placeholder={valuePlaceholder}
              varNames={varNames}
              onCreateVar={onCreateVar}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => remove(i)}
            aria-label="quitar fila"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add}>
        <Plus size={12} /> Agregar fila
      </Button>
    </div>
  );
}
