import { IconButton, Icons } from "@apx/ui";
import { dismiss, useNotices } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

export function Toasts() {
  const t = useT();
  const list = useNotices();
  if (!list.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={`toast is-${n.tone}`}>
          {n.tone === "error" ? <Icons.TriangleAlert size={14} /> : <Icons.Check size={14} />}
          <span className="toast__text">{n.text}</span>
          <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={() => dismiss(n.id)} />
        </div>
      ))}
    </div>
  );
}
