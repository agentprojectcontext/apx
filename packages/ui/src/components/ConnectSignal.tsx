import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icons } from "../icons";

export type ConnectSignalState = "idle" | "connecting" | "connected" | "broken";

export interface ConnectSignalProps {
  /** Where the link starts: APX for an account, or a device's app that pairs with APX. */
  from: ReactNode;
  to: ReactNode;
  state: ConnectSignalState;
  /** The state in words, under the marks. */
  label?: ReactNode;
  className?: string;
}

/** Two marks joined by dots: the dots move while it connects, turn solid once connected and break when it failed. */
export function ConnectSignal({ from, to, state, label, className }: ConnectSignalProps) {
  return (
    <div className={cx("apx-signal", `apx-signal--${state}`, className)}>
      <div className="apx-signal__link" aria-hidden="true">
        <span className="apx-signal__tile">{from}</span>
        <span className="apx-signal__dots">
          <i />
          <i />
          <i />
          <i />
          <i />
          {state === "broken" && (
            <span className="apx-signal__cut">
              <Icons.X size={10} />
            </span>
          )}
        </span>
        <span className="apx-signal__tile apx-signal__tile--to">{to}</span>
      </div>
      {label && (
        <span className="apx-signal__label" role="status">
          {state === "connected" && <Icons.Check size={13} />}
          {label}
        </span>
      )}
    </div>
  );
}
