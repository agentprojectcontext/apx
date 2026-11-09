import "../styles/section-page.css";
import { Button, Icons, SearchField } from "@apx/ui";
import type { ReactNode } from "react";
import { ProjectSelect, type ScopeOption } from "./ProjectSelect.tsx";

export type SectionAction = {
  label: string;
  /** What it does, shown as its tooltip. */
  hint: string;
  onClick(): void;
  icon?: ReactNode;
  loading?: boolean;
};

export type SectionSearch = {
  value: string;
  onChange(value: string): void;
  placeholder: string;
};

/**
 * A section's page (Tasks, Flows, Routines, Files, Computers, Resources, Channels): title and lead with the main action
 * at the right, then a row with its tabs, the project it shows, its tools and search, and the body.
 */
export function SectionPage({
  title,
  titleExtra,
  lead,
  action,
  tabs,
  tools,
  search,
  scopes,
  under,
  label,
  className,
  bodyClassName,
  children,
}: {
  /** None inside a project's tab, whose header already names it. */
  title?: ReactNode;
  /** Beside the title: a help button. */
  titleExtra?: ReactNode;
  lead?: ReactNode;
  /** The one primary action, or any control in its place. */
  action?: SectionAction | ReactNode;
  /** The segmented control that switches the page's views. */
  tabs?: ReactNode;
  /** After the tabs: which project (or scope) the page shows. */
  scopes?: { label: string; value: string; onChange(id: string): void; options: ScopeOption[] };
  /** Controls between the tabs and the search (an order, a filter). */
  tools?: ReactNode;
  search?: SectionSearch;
  /** A last line in the header: what the list shows. */
  under?: ReactNode;
  /** The page's accessible name. */
  label: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const bar = tabs || tools || search || scopes;
  return (
    <section className={className ? `secpage ${className}` : "secpage"} aria-label={label}>
      <header className="secpage__head">
        {(title || action) && (
          <div className="secpage__top">
            <div className="secpage__titles">
              {title && (
                <h1 className="secpage__title">
                  {title}
                  {titleExtra}
                </h1>
              )}
              {lead && <p className="secpage__lead">{lead}</p>}
            </div>
            {isAction(action) ? (
              <Button
                className="secpage__action"
                title={action.hint}
                loading={action.loading}
                leadingIcon={action.icon ?? <Icons.Plus size={14} />}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ) : (
              action
            )}
          </div>
        )}
        {bar && (
          <div className="secpage__bar">
            {tabs}
            {scopes && <ProjectSelect className="secpage__scope" {...scopes} />}
            <span className="secpage__spacer" />
            {tools}
            {search && (
              <SearchField
                size="sm"
                className="secpage__search"
                aria-label={search.placeholder}
                placeholder={search.placeholder}
                value={search.value}
                onChange={(e) => search.onChange(e.currentTarget.value)}
              />
            )}
          </div>
        )}
        {under}
      </header>
      <div className={bodyClassName ? `secpage__body ${bodyClassName}` : "secpage__body"}>{children}</div>
    </section>
  );
}

function isAction(a: unknown): a is SectionAction {
  return typeof a === "object" && a !== null && "onClick" in a && "label" in a && "hint" in a;
}
