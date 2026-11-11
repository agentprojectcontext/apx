import { Button, Icons, Popover, SearchField, Spinner } from "@apx/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useVariableNames } from "./useVariableNames.ts";
import { VariableDialog } from "./VariablesTab.tsx";

export function VariablePicker({
  project,
  rowLabel,
  request = 0,
  onPick,
}: {
  project?: string | undefined;
  rowLabel: string;
  request?: number;
  onPick(name: string): void;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { names, failed, retry } = useVariableNames(open, project);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.children.item(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (request) setOpen(true);
  }, [request]);
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);
  const shown = useMemo(
    () => (names ?? []).filter((name) => name.toLowerCase().includes(q.trim().toLowerCase())),
    [names, q],
  );
  const pick = (name: string) => {
    setOpen(false);
    onPick(name);
  };
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={300}
        align="end"
        label={t("res.pairInsertVar")}
        trigger={
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${t("res.pairInsertVar")} ${rowLabel}`}
            leadingIcon={<Icons.Plus size={14} />}
          >
            {t("res.pairInsertVar")}
          </Button>
        }
      >
        <div className="varpick">
          <SearchField
            size="sm"
            autoFocus
            aria-label={t("res.pairSearchVar")}
            placeholder={t("res.pairSearchVar")}
            value={q}
            aria-controls={id}
            aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
            onChange={(e) => {
              setQ(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((n) => Math.max(0, Math.min(shown.length - 1, n + (e.key === "ArrowDown" ? 1 : -1))));
              } else if (e.key === "Enter" && shown[active]) {
                e.preventDefault();
                pick(shown[active]);
              }
            }}
          />
          {!names && !failed && <Spinner />}
          {failed && (
            <div role="alert">
              <p className="varpick__empty">{t("res.variablesLoadError")}</p>
              <Button size="sm" variant="ghost" onClick={retry}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          <div ref={list} id={id} className="varpick__list" role="listbox" aria-label={t("res.pairInsertVar")}>
            {names && !shown.length && (
              <p className="varpick__empty">{t(names.length ? "res.noMatch" : "res.variablesEmpty")}</p>
            )}
            {shown.map((name, index) => (
              <Button
                key={name}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                variant="ghost"
                className="varpick__item"
                onClick={() => pick(name)}
              >
                {name}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="varpick__new"
            leadingIcon={<Icons.Plus size={13} />}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            {t("res.pairNewVar")}
          </Button>
        </div>
      </Popover>
      {creating && (
        <VariableDialog
          row={undefined}
          projectId={project}
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            onPick(name);
          }}
        />
      )}
    </>
  );
}
