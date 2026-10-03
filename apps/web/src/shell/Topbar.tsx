import { AgentAvatar, IconButton, Icons, Kbd, Menu } from "@apx/ui";
import { Fragment } from "react";
import logoUrl from "../assets/logo.png";
import { useChannels } from "../data/channels.ts";
import { blobOf, findProject, projectName, secretary } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { LANGUAGE_NAMES, LANGUAGES, type Language, useLanguage, useT } from "../i18n/index.ts";
import { AttentionTray } from "./AttentionTray.tsx";
import { go, PROJECT_TABS, useNav } from "./nav.ts";
import { RunningIndicator } from "./RunningIndicator.tsx";
import { UpdatePill } from "./UpdatePill.tsx";

const LANGS = Object.keys(LANGUAGES) as Language[];

/** SPEC §1.5: Inbox / project / chat · Projects / project / tab · External sessions / engine / chat · Apps · Tasks. */
function useCrumbs(): string[] {
  const t = useT();
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projectTab = useNav((s) => s.projectTab);
  const threadId = useNav((s) => s.threadId);
  const appId = useNav((s) => s.appId);
  const projects = useData((s) => s.projects);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  const channelId = useNav((s) => s.channelId);
  const channelLabel = useChannels((s) => s.channels.find((c) => c.id === channelId)?.label);
  const engineId = useNav((s) => s.engineId);
  const engineLabel = useData((s) => s.engines.find((e) => e.id === engineId)?.label);
  if (view === "app") return [t("nav.apps"), app?.title ?? t("common.app")];
  if (view === "tasks") return [t("nav.tasks")];
  if (view === "resources") return [t("nav.resources")];
  if (view === "channel") return [t("nav.channels"), channelLabel ?? t("nav.channels")];
  if (view === "engine") {
    const name = engineLabel ?? engineId ?? "";
    return thread ? [t("nav.externalSessions"), name, thread.title] : [t("nav.externalSessions"), name];
  }
  if (view === "project") {
    const tab = t(PROJECT_TABS.find((x) => x.id === projectTab)?.label ?? "project.tab.overview");
    return [t("nav.projects"), findProject(projects, projectId)?.name ?? t("project.fallback"), tab];
  }
  const inbox = t("nav.inbox");
  return thread ? [inbox, projectName(projects, thread.project_id), thread.title] : [inbox];
}

export function Topbar() {
  const t = useT();
  const crumbs = useCrumbs();
  const mode = useNav((s) => s.mode);
  const lang = useLanguage();
  const agents = useData((s) => s.agents);
  const homeId = useData((s) => Object.values(s.threads).find((x) => x.kind === "home")?.id);
  const sec = secretary(agents);
  const folded = usePrefs((s) => s.sidebarCollapsed);
  const languageItems = [
    { type: "label" as const, label: t("language.label") },
    ...LANGS.map((l) => ({
      label: LANGUAGE_NAMES[l],
      icon: l === lang ? <Icons.Check /> : <span />,
      onSelect: () => setPrefs({ language: l }),
    })),
  ];
  return (
    <header className="topbar">
      <img className="topbar__logo" src={logoUrl} alt="APX" width={22} height={22} />
      <IconButton
        size="sm"
        label={folded ? t("nav.expand") : t("nav.collapse")}
        icon={folded ? <Icons.PanelLeftOpen size={15} /> : <Icons.PanelLeftClose size={15} />}
        onClick={() => setPrefs({ sidebarCollapsed: !folded })}
      />
      <nav className="topbar__crumbs" aria-label={t("topbar.location")}>
        {crumbs.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs are positional
          <Fragment key={i}>
            {i > 0 && <span className="topbar__sep">/</span>}
            <span className={i === crumbs.length - 1 ? "topbar__crumb is-last" : "topbar__crumb"}>{c}</span>
          </Fragment>
        ))}
      </nav>
      <span className="topbar__spacer" />
      <button type="button" className="topbar__search" onClick={() => go.palette(true)}>
        <Icons.Search size={14} />
        <span className="topbar__search-label">{t("topbar.search")}</span>
        <Kbd keys={["⌘", "K"]} />
      </button>
      <span className="topbar__spacer" />
      <UpdatePill />
      <RunningIndicator />
      <AttentionTray />
      <div className="topbar__extras">
        <IconButton
          size="sm"
          label={t("phone.open")}
          icon={<Icons.Smartphone size={14} />}
          className="topbar__icon"
          onClick={() => go.phone(true)}
        />
        <Menu
          align="end"
          items={languageItems}
          trigger={
            <button
              type="button"
              className="topbar__lang"
              aria-label={t("language.current", { language: LANGUAGE_NAMES[lang] })}
            >
              <Icons.Languages size={14} />
              {lang.toUpperCase()}
            </button>
          }
        />
        <IconButton
          size="sm"
          label={mode === "dark" ? t("theme.light") : t("theme.dark")}
          icon={mode === "dark" ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
          className="topbar__icon"
          onClick={go.toggleMode}
        />
      </div>
      {/* Narrow windows fold phone, language and theme into one menu so the bar never scrolls sideways. */}
      <Menu
        align="end"
        items={[
          { label: t("phone.open"), icon: <Icons.Smartphone />, onSelect: () => go.phone(true) },
          {
            label: mode === "dark" ? t("theme.light") : t("theme.dark"),
            icon: mode === "dark" ? <Icons.Sun /> : <Icons.Moon />,
            onSelect: go.toggleMode,
          },
          { type: "separator" },
          ...languageItems,
        ]}
        trigger={
          <IconButton
            size="sm"
            label={t("topbar.more")}
            icon={<Icons.Ellipsis size={14} />}
            className="topbar__icon topbar__more"
          />
        }
      />
      {sec && (
        <button
          type="button"
          className="topbar__agent"
          title={t("topbar.chatWith", { name: sec.name })}
          onClick={() => homeId && go.inboxThread(homeId)}
          disabled={!homeId}
        >
          <AgentAvatar name={sec.name} blob={blobOf(sec)} size={24} />
          <span className="topbar__agentname">{sec.name}</span>
          <span className="topbar__agentkbd">⌘J</span>
        </button>
      )}
    </header>
  );
}
