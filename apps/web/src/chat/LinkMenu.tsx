import { Button, ContextMenu, Icons, type LinkRenderer, type MenuEntry, Tooltip } from "@apx/ui";
import { type ReactNode, useEffect } from "react";
import { CONFIG_SECTION_LABELS } from "../config/sectionLabels.ts";
import { browserOpen } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { openOutside, useInstalledBrowsers } from "../panel/browserWindow.ts";
import { go, nav } from "../shell/nav.ts";
import { type AppPlace, appPlace } from "./appLinks.ts";

/** Where a link can open (APX's browser, another one) and copying it: the right-click items of a link or a web image. */
export function useLinkItems(href: string): MenuEntry[] {
  const t = useT();
  const browsers = useInstalledBrowsers();
  const web = /^https?:/i.test(href);
  return [
    ...(web
      ? [
          {
            label: t("link.openApx"),
            icon: <Icons.PanelRight size={14} />,
            onSelect: async () => {
              const id = await browserOpen(href);
              if (!id) return;
              nav.set({ browserTab: id });
              go.panel("browser");
            },
          },
          { label: t("browser.openDefault"), icon: <Icons.Globe size={14} />, onSelect: () => openOutside(href) },
          ...browsers.map((b) => ({
            label: t("browser.openIn", { name: b.name }),
            onSelect: () => openOutside(href, b.id),
          })),
          { type: "separator" as const },
        ]
      : []),
    {
      label: t("link.copy"),
      icon: <Icons.Copy size={14} />,
      onSelect: () =>
        void navigator.clipboard.writeText(href).then(
          () => notify(t("link.copied"), "info"),
          () => {},
        ),
    },
  ];
}

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
  resources: <Icons.Wrench size={13} />,
  inbox: <Icons.Inbox size={13} />,
  chat: <Icons.MessageSquare size={13} />,
  project: <Icons.Folder size={13} />,
  computer: <Icons.Monitor size={13} />,
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
    case "resources":
      return t("link.go.resources", { name: t(`res.tab.${place.tab}`) });
    case "inbox":
      return t("link.go.inbox");
    case "chat":
      return chat ? t("link.go.chatNamed", { name: chat }) : t("link.go.chat");
    case "project":
      return project ? t("link.go.projectNamed", { name: project }) : t("link.go.project");
    case "computer":
      return t("nav.computers");
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

export const linkMenu: LinkRenderer = (href, link) =>
  /^apx:/i.test(href) ? (
    <AppLink href={href} label={(link.props as { children?: React.ReactNode }).children} />
  ) : (
    <LinkMenu href={href}>{link}</LinkMenu>
  );
