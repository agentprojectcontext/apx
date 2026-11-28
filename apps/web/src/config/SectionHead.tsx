import type { ReactNode, Ref } from "react";

/** Config section title (16/600) + one muted line, with optional actions on the right. */
export function SectionHead({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="config__head">
      <div className="config__headtext">
        <h2 className="config__title">{title}</h2>
        {lead && <p className="config__lead">{lead}</p>}
      </div>
      {actions && <div className="config__headactions">{actions}</div>}
    </div>
  );
}

/** Sub-heading inside a section ("Engines", "External sessions"); `ref`: a place the page scrolls or moves focus to. */
export function SubHead({ children, ref }: { children: ReactNode; ref?: Ref<HTMLHeadingElement> }) {
  return (
    <h3 className="config__sub" ref={ref} tabIndex={ref ? -1 : undefined}>
      {children}
    </h3>
  );
}
