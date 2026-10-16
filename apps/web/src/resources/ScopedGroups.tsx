import { Switch } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { getInheritance, setInheritance } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";

/** Whether a project takes the owner's global skills or servers; flipping it reloads the list (its "on" flags). */
export function useInheritance(projectId: string | undefined, kind: "skills" | "mcp", reload: () => Promise<unknown>) {
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    let live = true;
    if (projectId) void getInheritance(projectId).then((r) => live && r && setOn(r[kind]));
    return () => {
      live = false;
    };
  }, [projectId, kind]);
  const set = async (next: boolean) => {
    if (!projectId) return;
    const r = await setInheritance(projectId, kind, next);
    if (r) setOn(r[kind]);
    await reload();
  };
  return { on, set };
}

/**
 * A project's resources in two parts: its own (always shown, with a word when there are none) and the owner's global
 * ones under a switch that decides whether this project takes them at all (left out with `ownOnly`).
 */
export function ScopedGroups<T>({
  ownTitle,
  own,
  globals,
  inherit,
  emptyOwn,
  render,
  ownOnly = false,
}: {
  ownTitle: string;
  own: T[];
  globals: T[];
  inherit: { on: boolean | undefined; set(on: boolean): void };
  emptyOwn: string;
  render: (item: T) => ReactNode;
  ownOnly?: boolean;
}) {
  const t = useT();
  return (
    <>
      <div className="resv__group">
        <div className="resv__grouptitle">
          {ownTitle} <span>{own.length}</span>
        </div>
        {own.length ? own.map(render) : <p className="resv__groupempty">{emptyOwn}</p>}
      </div>
      {!ownOnly && (
        <div className={`resv__group${inherit.on === false ? " is-off" : ""}`}>
          <div className="resv__grouptitle resv__grouptitle--switch">
            <span className="resv__grouplabel">
              {t("res.group.global")} <span>{globals.length}</span>
            </span>
            <Switch
              size="sm"
              checked={inherit.on ?? true}
              disabled={inherit.on === undefined}
              label={t("res.useGlobals")}
              onCheckedChange={(v) => inherit.set(v)}
            />
          </div>
          {inherit.on === false && <p className="resv__groupempty">{t("res.globalsOffHere")}</p>}
          {globals.map(render)}
        </div>
      )}
    </>
  );
}
