import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the dialog. */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  /** Body. */
  children?: ReactNode;
  /** Action row, right-aligned (Buttons: secondary "Cancel" then primary). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * Custom layout (settings with a left nav): no padding, title only for screen readers,
   * close button floating top-right. `children` fill the popup; `description`/`footer` are ignored.
   */
  bare?: boolean;
  /** Accessible name of the close button. */
  closeLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Modal for confirmations and short forms. Avoid for notices — APX never uses modals for updates. */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
  bare = false,
  closeLabel = "Close",
  className,
  style,
}: DialogProps) {
  const { portalRef } = useApx();
  return (
    <BaseDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={(o) => onOpenChange?.(o)}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal container={portalRef}>
        <BaseDialog.Backdrop className="apx-dialog__backdrop" />
        <BaseDialog.Popup
          className={cx("apx-dialog", `apx-dialog--${size}`, bare && "apx-dialog--bare", className)}
          style={style}
        >
          {bare ? (
            <>
              <BaseDialog.Title className="apx-sr-only">{title}</BaseDialog.Title>
              <BaseDialog.Close className="apx-dialog__close apx-dialog__close--float" aria-label={closeLabel}>
                <X size={18} />
              </BaseDialog.Close>
              {children}
            </>
          ) : (
            <>
              <div className="apx-dialog__head">
                <BaseDialog.Title className="apx-dialog__title">{title}</BaseDialog.Title>
                <BaseDialog.Close className="apx-dialog__close" aria-label={closeLabel}>
                  <X size={16} />
                </BaseDialog.Close>
              </div>
              {description && (
                <BaseDialog.Description className="apx-dialog__desc">{description}</BaseDialog.Description>
              )}
              {children && <div className="apx-dialog__body">{children}</div>}
              {footer && <div className="apx-dialog__footer">{footer}</div>}
            </>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
