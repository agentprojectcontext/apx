import { Button, ContextMenu, Icons, Tooltip } from "@apx/ui";
import { type ReactNode, useEffect } from "react";
import { CONFIG_SECTION_LABELS } from "../config/sectionLabels.ts";
import { useData } from "../data/state.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { type AppPlace, appPlace } from "./appLinks.ts";
import { useLinkItems } from "./linkItems.tsx";

/** A link in a message: a click opens it as usual; a right-click says where (APX's browser, another one) or copies it. */
function LinkMenu({ href, children }: { href: string; children: React.ReactElement }) {
  const items = useLinkItems(href);
  // The trigger renders as the link itself; its text stays its own.
  return (
    <ContextMenu items={items} render={children}>
      {(children.props as { children?: React.ReactNode }).children}
    </ContextMenu>
  );
}

const PLACE_ICON: Record<AppPlace["kind"], ReactNode> = {
  settings: <Icons.Settings size={13} />,
  task: <Icons.ListChecks size={13} />,
  tasks: <Icons.ListChecks size={13} />,
  flows: <Icons.GitBranch size={13} />,
  resources: <Icons.Wrench size={13} />,
  inbox: <Icons.Inbox size={13} />,
  chat: <Icons.MessageSquare size={13} />,
  project: <Icons.Folder size={13} />,
  computer: <Icons.Monitor size={13} />,
  channels: <Icons.MessageCircle size={13} />,
};

/** What a click on an app link does, in words: where it goes, by name when the panel knows it. */
function usePlaceHint(place: AppPlace | undefined): string {
  const t = useT();
  const id = place && "id" in place ? place.id : "";
  const task = useTasks((s) => (place?.kind === "task" ? s.tasks[id] : undefined));
  const chat = useData((s) => (place?.kind === "chat" ? s.threads[id]?.title : undefined));
  const project = useData((s) => (place?.kind === "project" ? s.projects.find((p) => p.id === id)?.name : undefined));
  useEffect(() => {
    if (place?.kind === "task") ensureTask(id);
  }, [place?.kind, id]);
  switch (place?.kind) {
    case "settings": {
      const section = CONFIG_SECTION_LABELS[place.section];
      return section ? t("link.go.settingsSection", { name: t(section) }) : t("link.go.settings");
    }
    case "task":
      return t("link.go.task", { name: task?.title ?? id });
    case "tasks":
      return t("link.go.tasks");
    case "flows":
      return place.flow ? t("link.go.flow") : t("nav.flows");
    case "resources":
      return place.server
        ? `${t("res.mcpOpen")}: ${place.server}`
        : t("link.go.resources", { name: t(`res.tab.${place.tab}`) });
    case "inbox":
      return t("link.go.inbox");
    case "chat":
      return chat ? t("link.go.chatNamed", { name: chat }) : t("link.go.chat");
    case "project":
      return project ? t("link.go.projectNamed", { name: project }) : t("link.go.project");
    case "computer":
      return t("nav.computers");
    case "channels":
      return t("nav.channels");
    default:
      return "";
  }
}

/** A link an agent wrote into the app: a tinted button with its place's icon, or its label when it names no place. */
function AppLink({ href, label }: { href: string; label: ReactNode }) {
  const place = appPlace(href);
  const hint = usePlaceHint(place);
  if (!place) return <>{label}</>;
  return (
    <Tooltip content={hint}>
      <Button
        size="sm"
        variant="secondary"
        className="applink"
        data-place={place.kind}
        aria-description={hint}
        leadingIcon={PLACE_ICON[place.kind]}
        trailingIcon={<Icons.ArrowRight size={13} />}
        onClick={place.open}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

/** A link in a message: an app link as its button, any other with its right-click menu. */
export function MessageLink({ href, link }: { href: string; link: React.ReactElement }) {
  return /^apx:/i.test(href) ? (
    <AppLink href={href} label={(link.props as { children?: React.ReactNode }).children} />
  ) : (
    <LinkMenu href={href}>{link}</LinkMenu>
  );
}
