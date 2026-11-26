import type { Result } from "@apx/protocol";
import { Button, Checkbox, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../../data/client.ts";
import { isInside, samePath } from "../../data/paths.ts";
import { useT } from "../../i18n/index.ts";
import { migrationPathSelected, toggleMigrationPath } from "./migration.ts";

export function MigrationFiles({
  project,
  paths,
  onChange,
}: {
  project: string;
  paths: string[];
  onChange(paths: string[]): void;
}) {
  const t = useT();
  const [folder, setFolder] = useState({ dir: "" });
  const { dir } = folder;
  const [tree, setTree] = useState<Result<"files.tree">>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setTree(undefined);
    setError(false);
    client.call("files.tree", { project, dir: folder.dir }).then(
      (r) => {
        if (live) setTree(r);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [project, folder]);
  return (
    <section className="agentmove__files" aria-label={t("team.move.files")}>
      <h3>{t("team.move.files")}</h3>
      <p>{t("team.move.filesHint")}</p>
      <div className="agentmove__folder">
        <Button
          size="sm"
          variant="secondary"
          disabled={!dir}
          onClick={() => setFolder({ dir: dir.split(/[/\\]/).slice(0, -1).join("/") })}
          leadingIcon={<Icons.ArrowLeft size={14} />}
        >
          {t("team.move.up")}
        </Button>
        <span>{dir || t("team.move.root")}</span>
      </div>
      {error ? (
        <div role="alert">
          <p>{t("team.move.filesError")}</p>
          <Button size="sm" onClick={() => setFolder({ dir })}>
            {t("team.move.retry")}
          </Button>
        </div>
      ) : !tree ? (
        <p role="status">{t("team.move.loading")}</p>
      ) : (
        <>
          <ul className="agentmove__list">
            {tree.entries
              .filter(
                (e) =>
                  (e.kind === "dir" || e.kind === "file") &&
                  ![".apx", ".git", "node_modules", "AGENTS.md", ".env"].includes(e.name),
              )
              .map((e) => (
                <li key={e.path}>
                  <Checkbox
                    label={e.name}
                    checked={migrationPathSelected(paths, e.path)}
                    disabled={paths.some((p) => !samePath(p, e.path) && isInside(p, e.path))}
                    onCheckedChange={(checked) => onChange(toggleMigrationPath(paths, e.path, checked === true))}
                  />
                  {e.kind === "dir" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("team.move.browse", { name: e.name })}
                      onClick={() => setFolder({ dir: e.path })}
                    >
                      <Icons.ChevronRight size={16} />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
          {!tree.entries.length && <p>{t("team.move.emptyFolder")}</p>}
          {tree.truncated && <p role="status">{t("team.move.truncated")}</p>}
        </>
      )}
      <p>{t("team.move.selected", { n: paths.length })}</p>
      {paths.length > 0 && (
        <ul className="agentmove__paths">
          {paths.map((p) => (
            <li key={p}>
              <span>{p}</span>
              <Button size="sm" variant="ghost" onClick={() => onChange(paths.filter((v) => v !== p))}>
                {t("team.move.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
