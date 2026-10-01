import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SettingRowProps {
  /** Setting name. */
  title: ReactNode;
  /** One muted line explaining the effect. */
  description?: ReactNode;
  /** The control on the right: Switch, SegmentedControl, Button, a value. */
  children?: ReactNode;
  className?: string;
}

/** One settings line: title + description on the left, control on the right, hairline on top. */
export function SettingRow({ title, description, children, className }: SettingRowProps) {
  return (
    <div className={cx("apx-setting", className)}>
      <div className="apx-setting__text">
        <div className="apx-setting__title">{title}</div>
        {description && <div className="apx-setting__desc">{description}</div>}
      </div>
      {children != null && <div className="apx-setting__control">{children}</div>}
    </div>
  );
}
