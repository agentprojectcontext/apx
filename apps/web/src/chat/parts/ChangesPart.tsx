import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useT } from "../../i18n/index.ts";

/** What a code thread's folder has uncommitted after the turn, as git sees it. */
export function ChangesPart({ part }: { part: Extract<Part, { type: "changes" }> }) {
  const t = useT();
  const n = part.files.length + (part.more ?? 0);
  return (
    <div className="changes">
      <div className="changes__head">
        <Icons.FileText size={14} />
        <span>{t("changes.title", { n })}</span>
        <span className="changes__cwd" title={part.cwd}>
          {part.cwd}
        </span>
      </div>
      <ul className="changes__list">
        {part.files.map((f) => (
          <li key={f.path} className="changes__file">
            <span className={`changes__status is-${f.status === "??" ? "new" : f.status.toLowerCase()}`}>
              {f.status === "??" ? "+" : f.status}
            </span>
            <span className="changes__path">{f.path}</span>
            {f.added !== undefined && (
              <span className="changes__stat">
                <span className="is-add">+{f.added}</span> <span className="is-del">-{f.removed}</span>
              </span>
            )}
          </li>
        ))}
        {part.more ? <li className="changes__more">{t("changes.more", { n: part.more })}</li> : null}
      </ul>
    </div>
  );
}
