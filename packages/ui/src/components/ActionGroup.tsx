import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { StatusIcon, type StepStatus } from "./StatusIcon";

export interface ActionItem {
  /** Tool name, e.g. "fs.read", "browser.open". */
  name: ReactNode;
  /** Argument or result summary, one line. */
  detail?: ReactNode;
  status?: StepStatus;
  /** Duration or size, right-aligned ("1.2s"). */
  aside?: ReactNode;
}

export interface ActionGroupProps {
  /** Header text: "Actions 1–10 of 16", "Worked 2 min". */
  title: ReactNode;
  /** Number of failed actions — shown in danger after the title. */
  failed?: number;
  /** Label for the failed count ("failed", "fallaron"). */
  failedLabel?: string;
  /** Tool calls listed when expanded. */
  items?: ActionItem[];
  defaultOpen?: boolean;
  /** Leading icon; defaults to a wrench. */
  icon?: ReactNode;
  /** Custom expanded content instead of `items` (reasoning text, a diff). */
  children?: ReactNode;
  className?: string;
}

/** Folds an agent's tool calls/reasoning into one line ("Worked 2 min ▸") that expands to the list. */
export function ActionGroup({
  title,
  failed = 0,
  failedLabel = "failed",
  items,
  defaultOpen = false,
  icon,
  children,
  className,
}: ActionGroupProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={cx("apx-actions", className)}>
      <Collapsible.Trigger className="apx-actions__head">
        <ChevronRight size={14} className="apx-actions__chevron" />
        <span className="apx-actions__icon">{icon ?? <Wrench size={14} />}</span>
        <span className="apx-actions__title">{title}</span>
        {failed > 0 && (
          <span className="apx-actions__failed">
            · {failed} {failedLabel}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="apx-actions__panel">
        {children ?? (
          <ul className="apx-actions__list">
            {items?.map((it, i) => (
              <li key={i} className={cx("apx-actions__item", it.status === "failed" && "is-failed")}>
                <StatusIcon status={it.status ?? "done"} />
                <span className="apx-actions__name">{it.name}</span>
                {it.detail && <span className="apx-actions__detail">{it.detail}</span>}
                {it.aside && <span className="apx-actions__aside">{it.aside}</span>}
              </li>
            ))}
          </ul>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
