import type { SurfaceSummary } from "@apx/protocol";
import { Button, IconButton, Icons, type MenuEntry, Popover, SegmentedControl, Select } from "@apx/ui";
import { useEffect, useState } from "react";
import { shareSurface } from "../data/actions.ts";
import { downloadPage, exportArtifact } from "../data/artifacts.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { t as tr, useT } from "../i18n/index.ts";
import { openPublicLink, publicLink } from "./public-link.ts";
import { loadPublicCopies, openLiveLink, publicCopyOf, usePublicCopyOf } from "./publicCopies.ts";
import { openPublicCopy } from "./publicRequest.ts";

// Who can see an artifact, as one choice with its own link: only you (your APX, on your devices), public (a copy at
// apxagent.app anyone opens without an account) or live from this computer (its public address, while it is on).

type Access = "private" | "public" | "live";

/** Each access shows its own mark, on the Share button too: a lock, the world or this computer. */
const ACCESS_ICON = {
  private: (size: number) => <Icons.Lock size={size} />,
  public: (size: number) => <Icons.Globe size={size} />,
  live: (size: number) => <Icons.Monitor size={size} />,
} satisfies Record<Access, (size: number) => unknown>;

async function liveLink(path: string): Promise<string> {
  const address = await client.call("webhooks.get", {});
  return publicLink(path, address);
}

export function linkOf(s: SurfaceSummary): string | undefined {
  return s.share_path;
}

/** Where this artifact opens in your own APX, from any of your devices. */
const privateLink = (surface: string) => `${window.location.origin}/#app=${surface}`;

async function copyText(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify(tr("share.copied"), "info");
  } catch {
    notify(tr("share.copyFailed"));
  }
}

/** Opens a link outside the panel: the desktop app hands it to the browser, a browser opens a tab. */
async function openOutside(load: () => Promise<string>): Promise<void> {
  const desktop = window.apxDesktop;
  if (desktop?.openExternal) {
    await desktop.openExternal(await load());
    return;
  }
  await openPublicLink(load, () => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) return null;
    tab.opener = null;
    const policy = tab.document.createElement("meta");
    policy.name = "referrer";
    policy.content = "no-referrer";
    tab.document.head.append(policy);
    return { navigate: (value) => tab.location.replace(value), close: () => tab.close() };
  });
}

const accessOf = (surface: SurfaceSummary, copy: { code: string } | undefined): Access =>
  copy ? "public" : linkOf(surface) ? "live" : "private";

/** Moves an artifact to another access: public and stopping a copy go through their review, live through its own. */
function choose(surface: SurfaceSummary, copy: { code: string } | undefined, next: Access): void {
  if (next === "public") openPublicCopy({ action: "publish", surface: surface.id });
  else if (next === "live") openLiveLink(surface.id);
  else {
    if (linkOf(surface)) void shareSurface(surface.id, false);
    if (copy) openPublicCopy({ action: "revoke", code: copy.code });
  }
}

/** The same choices inside an artifact's ⋯ menu: who can see it, and its link. */
export function shareEntries(surface: SurfaceSummary, t: typeof tr): MenuEntry[] {
  void loadPublicCopies();
  const copy = publicCopyOf(surface.id);
  const access = accessOf(surface, copy);
  const mark = (a: Access, label: string) => (access === a ? `${label} ✓` : label);
  return [
    {
      label: mark("private", t("share.private")),
      icon: <Icons.Lock size={16} />,
      onSelect: () => access !== "private" && choose(surface, copy, "private"),
    },
    {
      label: mark("public", t("share.anyone")),
      icon: <Icons.Globe size={16} />,
      onSelect: () => access !== "public" && choose(surface, copy, "public"),
    },
    {
      label: mark("live", t("share.live")),
      icon: <Icons.Monitor size={16} />,
      onSelect: () => !linkOf(surface) && choose(surface, copy, "live"),
    },
    { type: "separator" },
    {
      label: t(access === "public" ? "share.copyPublic" : access === "live" ? "share.liveCopy" : "share.copyPrivate"),
      icon: <Icons.Link size={16} />,
      onSelect: () => void copyCurrent(surface, copy),
    },
  ];
}

async function copyCurrent(surface: SurfaceSummary, copy: { url: string } | undefined): Promise<void> {
  const live = linkOf(surface);
  if (copy) return copyText(copy.url);
  if (!live) return copyText(privateLink(surface.id));
  try {
    await copyText(await liveLink(live));
  } catch {
    notify(tr("share.linkUnavailable"));
  }
}

/** Turns on the live link once the owner read what it is, and copies it. */
export async function turnOnLiveLink(surface: string): Promise<void> {
  const path = await shareSurface(surface, true);
  if (!path) return;
  try {
    await copyText(await liveLink(path));
  } catch {
    notify(tr("share.linkUnavailable"));
  }
}

/** The link of the current access, shown read-only with a way to open it. */
function LinkRow({ surface, copy }: { surface: SurfaceSummary; copy: { url: string } | undefined }) {
  const t = useT();
  const live = linkOf(surface);
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let current = true;
    setMissing(false);
    if (copy) setUrl(copy.url);
    else if (!live) setUrl(privateLink(surface.id));
    else {
      setUrl(undefined);
      void liveLink(live).then(
        (value) => current && setUrl(value),
        () => current && setMissing(true),
      );
    }
    return () => {
      current = false;
    };
  }, [copy, live, surface.id]);
  if (missing) return <p className="share-panel__hint">{t("share.tunnelHint")}</p>;
  return (
    <div className="share-panel__link">
      <span>{(url ?? "").replace(/^https?:\/\//, "")}</span>
      {url && (copy || live) && (
        <IconButton
          size="sm"
          label={t("share.open")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => void openOutside(async () => url).catch(() => notify(t("share.linkUnavailable")))}
        />
      )}
    </div>
  );
}

/** The artifact as a file: an .apxart to open in another APX (alone or with what it remembers), a page as HTML. */
function ExportList({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const rows = [
    {
      key: "plain",
      icon: <Icons.File size={18} />,
      title: t("share.exportApx"),
      hint: t("share.exportApxHint"),
      run: () => exportArtifact(surface.id, false),
    },
    {
      key: "memory",
      icon: <Icons.Database size={18} />,
      title: t("share.exportMemory"),
      hint: t("share.exportMemoryHint"),
      run: () => exportArtifact(surface.id, true),
    },
    ...(surface.page
      ? [
          {
            key: "html",
            icon: <Icons.Code size={18} />,
            title: t("share.exportHtml"),
            hint: t("share.exportHtmlHint"),
            run: () => downloadPage(surface.id),
          },
        ]
      : []),
  ];
  return (
    <ul className="share-panel__exports">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="share-panel__exporticon">{row.icon}</span>
          <span className="share-panel__exporttext">
            <strong>{row.title}</strong>
            <small>{row.hint}</small>
          </span>
          <IconButton
            size="sm"
            label={t("share.exportDownload", { what: row.title })}
            icon={<Icons.Download size={16} />}
            onClick={() => void row.run()}
          />
        </li>
      ))}
    </ul>
  );
}

/** Share: who can see this artifact (only you, public, or live from this computer) and its link to copy. */
export function ShareMenu({ surface, variant = "button" }: { surface: SurfaceSummary; variant?: "button" | "icon" }) {
  const t = useT();
  const copy = usePublicCopyOf(surface.id);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "export">("share");
  const access = accessOf(surface, copy);
  const shared = access !== "private";
  const pick = (next: string | null) => {
    if (!next || next === access) return;
    setOpen(false);
    choose(surface, copy, next as Access);
  };
  const trigger =
    variant === "icon" ? (
      <IconButton
        size="sm"
        label={t("share.iconLabel", { state: shared ? t("share.shared") : t("share.private") })}
        icon={ACCESS_ICON[access](14)}
        active={shared}
      />
    ) : (
      <Button size="sm" variant="secondary" leadingIcon={ACCESS_ICON[access](14)}>
        {shared ? t("share.shared") : t("share.share")}
      </Button>
    );
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={360}
      className="share-popover"
      label={t("share.panelTitle", { title: surface.title })}
    >
      <div className="share-panel">
        <h3 className="share-panel__title">{t("share.panelTitle", { title: surface.title })}</h3>
        <SegmentedControl
          size="sm"
          label={t("share.panelTitle", { title: surface.title })}
          value={tab}
          onValueChange={(next) => setTab(next as "share" | "export")}
          options={[
            { value: "share", label: t("share.share") },
            { value: "export", label: t("share.export") },
          ]}
        />
        {tab === "export" ? (
          <ExportList surface={surface} />
        ) : (
          <>
            <Select
              label={t("share.who")}
              value={access}
              onValueChange={pick}
              options={[
                {
                  value: "private",
                  label: t("share.private"),
                  description: t("share.privateHint"),
                  icon: ACCESS_ICON.private(16),
                },
                {
                  value: "public",
                  label: t("share.anyone"),
                  description: t("share.anyoneHint"),
                  icon: ACCESS_ICON.public(16),
                },
                {
                  value: "live",
                  label: t("share.live"),
                  description: t("share.liveHint"),
                  icon: ACCESS_ICON.live(16),
                },
              ]}
            />
            <p className="share-panel__hint">
              {t(access === "public" ? "share.anyoneHint" : access === "live" ? "share.liveHint" : "share.privateHint")}
            </p>
            <LinkRow surface={surface} copy={copy} />
            {copy && linkOf(surface) && (
              <p className="share-panel__hint">
                {t("share.alsoLive")}{" "}
                <Button size="sm" variant="link" onClick={() => void shareSurface(surface.id, false)}>
                  {t("share.liveOff")}
                </Button>
              </p>
            )}
            <div className="share-panel__actions">
              {copy && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="share-panel__update"
                  onClick={() => {
                    setOpen(false);
                    openPublicCopy({ action: "update", code: copy.code, surface: surface.id });
                  }}
                >
                  {t("share.update")}
                </Button>
              )}
              <Button size="sm" leadingIcon={<Icons.Link size={14} />} onClick={() => void copyCurrent(surface, copy)}>
                {t(
                  access === "public" ? "share.copyPublic" : access === "live" ? "share.liveCopy" : "share.copyPrivate",
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
