import { useRef } from "react";
import { Textarea } from "../ui";
import { cn } from "../../lib/cn";

type Var = { v: string };

// A labelled textarea with its context's variables as click-to-insert chips
// underneath. The chips have NO tooltip (the explanations live in the
// "available variables" reference card); clicking one drops the token at the
// caret (or appends it). Label is a <div> (not <label>) so the chip buttons
// don't collide with native label→control focusing. The hint sits under the
// title, above the textarea.
export function VarTextarea({
  label, hint, value, onChange, vars, rows = 3, mono, placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  vars: Var[];
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const insert = (token: string) => {
    const ta = wrapRef.current?.querySelector("textarea");
    if (!ta) { onChange(value ? `${value}${token}` : token); return; }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
      <div ref={wrapRef} className="space-y-1.5">
        <Textarea
          rows={rows}
          className={cn(mono && "font-mono text-xs")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {vars.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {vars.map((v) => (
              <button
                key={v.v}
                type="button"
                onClick={() => insert(v.v)}
                className="inline-flex items-center rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-fg transition-colors hover:border-muted-fg/50 hover:text-foreground"
              >
                {v.v}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
