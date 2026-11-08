import "../styles/section-page.css";
import { Button, Icons, SearchField } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

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

/** `id` "all" is the chip that shows everything. */
export type ScopeOption = { id: string; label: string };

/**
 * A section's page (Tasks, Flows, Routines, Files, Computers, Resources, Channels): title and lead with the main action
 * at the right, then a row with its tabs and search, then the chips that pick a project or scope, and the body.
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
  /** Controls between the tabs and the search (an order, a filter). */
  tools?: ReactNode;
  search?: SectionSearch;
  scopes?: { label: string; value: string; onChange(id: string): void; options: ScopeOption[] };
  /** A last line in the header: what the list shows. */
  under?: ReactNode;
  /** The page's accessible name. */
  label: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const bar = tabs || tools || search;
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
        {scopes && <ScopeChips {...scopes} />}
        {under}
      </header>
      <div className={bodyClassName ? `secpage__body ${bodyClassName}` : "secpage__body"}>{children}</div>
    </section>
  );
}

function isAction(a: unknown): a is SectionAction {
  return typeof a === "object" && a !== null && "onClick" in a && "label" in a && "hint" in a;
}

/** "Project: All · Default · …": one pressed at a time, the pressed one inverted. */
function ScopeChips({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(id: string): void;
  options: ScopeOption[];
}) {
  const t = useT();
  return (
    <fieldset className="secpage__scopes">
      <legend className="secpage__scopelabel">{label}</legend>
      {options.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant="ghost"
          className={value === o.id ? "secpage__chip is-on" : "secpage__chip"}
          aria-pressed={value === o.id}
          title={o.id === "all" ? t("section.scope.allHint") : t("section.scope.onlyHint", { name: o.label })}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </fieldset>
  );
}
