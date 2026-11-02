import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { keyed } from "../keys";
import { Spinner } from "./Spinner";
import { StatusIcon, type StepStatus } from "./StatusIcon";

export interface ActionItem {
  /** What it did, in words: "Opened acme.com", "Memory saved". */
  name: ReactNode;
  /** The kind of action (a globe for the web, a file for a read); without one, a status glyph shows instead. */
  icon?: ReactNode;
  /** Argument or result summary, one line. */
  detail?: ReactNode;
  status?: StepStatus;
  /** Duration or size, right-aligned ("1.2s"). */
  aside?: ReactNode;
}

export interface ActionGroupProps {
  /** Header text: "16 steps · 2 min 10 s", "Working · step 3". */
  title: ReactNode;
  /** Number of failed actions — shown in danger after the title. */
  failed?: number;
  /** Label for the failed count ("failed"); pass a translation. */
  failedLabel?: string;
  /** Tool calls listed when expanded. */
  items?: ActionItem[];
  defaultOpen?: boolean;
  /** Leading icon; defaults to a wrench, `null` for none (the chevron alone). */
  icon?: ReactNode;
  /** Custom expanded content instead of `items` (reasoning text, a diff). */
  children?: ReactNode;
  className?: string;
}

/**
 * Folds an agent's tool calls/reasoning into one line ("Worked 2 min ▸") that expands to the list: each action hangs
 * from one line with the icon of its kind; only a failed one is marked (in red), a running one spins.
 */
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
        {icon !== null && <span className="apx-actions__icon">{icon ?? <Wrench size={14} />}</span>}
        <span className="apx-actions__title">{title}</span>
        {failed > 0 && (
          <span className="apx-actions__failed">
            · {failed} {failedLabel}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="apx-actions__panel">
        {children ?? (
          <ul className="apx-actions__list apx-branches">
            {keyed(items ?? [], (it) => it.name).map(({ item: it, key }) => (
              <li key={key} className={cx("apx-actions__item", it.status === "failed" && "is-failed")}>
                <span className="apx-actions__itemicon">
                  {it.status === "running" ? (
                    <Spinner size={12} />
                  ) : (
                    (it.icon ?? <StatusIcon status={it.status ?? "done"} />)
                  )}
                </span>
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
