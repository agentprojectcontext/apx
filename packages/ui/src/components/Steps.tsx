import { Fragment } from "react";
import { cx } from "../cx";
import { Icons } from "../icons";

export interface StepsProps {
  /** Each step's name, in order. */
  steps: string[];
  /** The step under way (0-based); the ones before it show done. `steps.length`: all done. */
  current: number;
  className?: string;
}

/** A short trail of numbered steps ("1 Add — 2 Connect"): done ones checked, the current one marked. */
export function Steps({ steps, current, className }: StepsProps) {
  return (
    <ol className={cx("apx-trail", className)}>
      {steps.map((s, n) => (
        <Fragment key={s}>
          {n > 0 && <li className="apx-trail__rule" aria-hidden="true" />}
          <li
            className={cx("apx-trail__step", n < current && "is-done", n === current && "is-current")}
            aria-current={n === current ? "step" : undefined}
          >
            <span className="apx-trail__n">{n < current ? <Icons.Check size={10} /> : n + 1}</span>
            {s}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
