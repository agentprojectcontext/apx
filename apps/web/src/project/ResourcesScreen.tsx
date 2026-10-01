import { Button, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { DEFAULT_PID, findProject } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ProjectResources } from "./ProjectResources.tsx";

/** Resources as a top-level view: what every agent can use (the owner's skills and MCP servers) and the extensions. */
export function ResourcesScreen() {
  const t = useT();
  const projects = useData((s) => s.projects);
  const base = findProject(projects, DEFAULT_PID);
  const [extensions, setExtensions] = useState<{ on: number; all: number }>();
  useEffect(() => {
    client
      .call("extensions.list", {})
      .then((r) => setExtensions({ on: r.extensions.filter((e) => e.enabled).length, all: r.extensions.length }))
      .catch(() => setExtensions(undefined));
  }, []);
  const title = t("nav.resources");
  return (
    <section className="page" aria-label={title}>
      <header className="page__head">
        <h1 className="page__title">{title}</h1>
        <p className="page__lead">{t("resources.lead")}</p>
      </header>
      <div className="tgtoken resources__ext">
        <Icons.Layers size={16} />
        <span className="res__name">{t("config.extensions")}</span>
        <span className="pform__hint">
          {extensions ? t("resources.extensions", { on: extensions.on, all: extensions.all }) : ""}
        </span>
        <span className="pcard__spacer" />
        <Button size="sm" variant="secondary" onClick={() => go.config("extensions")}>
          {t("resources.manage")}
        </Button>
      </div>
      {base && <ProjectResources project={base} />}
    </section>
  );
}
