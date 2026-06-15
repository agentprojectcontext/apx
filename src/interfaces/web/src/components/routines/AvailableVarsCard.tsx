import { Tip } from "../ui";
import { t } from "../../i18n";
import { routineVars } from "./shared";

// Reference card (lives under the options column): every variable with its
// context tag + a hover tooltip explaining it. The click-to-insert chips under
// each textarea are tooltip-free — the explanation lives here.
export function AvailableVarsCard() {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("project.routines.vars_title")}</div>
      <div className="flex flex-wrap gap-1.5">
        {routineVars().map((v) => (
          <Tip key={v.v} content={<span className="block max-w-[240px] whitespace-normal leading-snug">{v.desc}</span>}>
            <span className="inline-flex cursor-help items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">
              {v.v}<span className="not-italic text-muted-fg">· {v.where}</span>
            </span>
          </Tip>
        ))}
      </div>
    </div>
  );
}
