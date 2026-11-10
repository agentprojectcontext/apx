import { IconButton, Icons, Kbd, Menu, Tooltip } from "@apx/ui";
import { Suspense } from "react";
import logoUrl from "../assets/logo.png";
import { secretary } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { EngineUsageButton, RunningIndicator, UsageButton } from "../lazy.ts";
import { AttentionTray } from "./AttentionTray.tsx";
import { useDesktopClass } from "./desktop.ts";
import { go, useNavHistory } from "./nav.ts";
import { ServerSwitch } from "./ServerSwitch.tsx";
import { SuperAgentButton } from "./SuperAgentButton.tsx";
import { UpdatePill, WhatsNewPill } from "./UpdatePill.tsx";
import { useTopbarFit } from "./useTopbarFit.ts";

export function Topbar() {
  const t = useT();
  const desktop = useDesktopClass();
  const rightRef = useTopbarFit();
  const canBack = useNavHistory((s) => s.canBack);
  const canForward = useNavHistory((s) => s.canForward);
  const agents = useData((s) => s.agents);
  const sec = secretary(agents);
  return (
    <header className={`topbar${desktop}`}>
      <div className="topbar__left">
        <img className="topbar__logo" src={logoUrl} alt="APX" width={16} height={16} />
        <ServerSwitch />
      </div>
      <div className="topbar__center">
        <div className="topbar__nav">
          <IconButton
            size="sm"
            label={t("nav.back")}
            icon={<Icons.ArrowLeft size={15} />}
            disabled={!canBack}
            onClick={go.back}
          />
          <IconButton
            size="sm"
            label={t("nav.forward")}
            icon={<Icons.ArrowRight size={15} />}
            disabled={!canForward}
            onClick={go.forward}
          />
        </div>
        <Tooltip content={t("topbar.search")} side="bottom" shortcut="⌘K">
          <button
            type="button"
            className="topbar__search"
            aria-label={t("topbar.search")}
            onClick={() => go.palette(true)}
          >
            <Icons.Search size={14} />
            <span className="topbar__search-label">{t("topbar.search")}</span>
            <Kbd keys={["⌘", "K"]} data-shortcut-modifier />
          </button>
        </Tooltip>
      </div>
      <div className="topbar__right" ref={rightRef}>
        <div className="topbar__activity">
          <AttentionTray />
          <Suspense
            fallback={
              <IconButton
                size="sm"
                className="running"
                label={t("running.label")}
                icon={<Icons.Bot size={14} />}
                disabled
              />
            }
          >
            <RunningIndicator />
          </Suspense>
          <WhatsNewPill />
          <UpdatePill />
        </div>
        <div className="topbar__usage">
          <Suspense
            fallback={<IconButton size="sm" label={t("engineUsage.title")} icon={<Icons.Zap size={14} />} disabled />}
          >
            <EngineUsageButton />
          </Suspense>
          <Suspense
            fallback={<IconButton size="sm" label={t("sysUsage.title")} icon={<Icons.Monitor size={14} />} disabled />}
          >
            <UsageButton />
          </Suspense>
        </div>
        {/* System usage remains reachable when its gauge no longer fits. */}
        <Menu
          align="end"
          items={[{ label: t("sysUsage.title"), icon: <Icons.Monitor />, onSelect: () => go.usageDialog(true) }]}
          trigger={
            <IconButton
              size="sm"
              label={t("topbar.more")}
              icon={<Icons.Ellipsis size={14} />}
              className="topbar__icon topbar__more"
            />
          }
        />
        {sec && <SuperAgentButton agent={sec} />}
      </div>
    </header>
  );
}
