import type { SurfaceSummary } from "@apx/protocol";
import { Button, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useEffect, useState } from "react";
import { shareSurface } from "../data/actions.ts";
import { client } from "../data/client.ts";

import { notify } from "../data/notices.ts";
import { t as tr, useT } from "../i18n/index.ts";
import { openPublicLink, publicLink } from "./public-link.ts";
import { loadPublicCopies, openLiveLink, publicCopyOf, usePublicCopyOf } from "./publicCopies.ts";
import { openPublicCopy } from "./publicRequest.ts";

async function publicShareLink(path: string): Promise<string> {
  const address = await client.call("webhooks.get", {});
  return publicLink(path, address);
}

function PublicLinkPreview({ path }: { path: string }) {
  const t = useT();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = true;
    setUrl(undefined);
    void publicShareLink(path).then(
      (value) => {
        if (current) setUrl(value);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [path]);
  return <span className="share__url">{url ?? t("share.linkUnavailable")}</span>;
}

export function linkOf(s: SurfaceSummary): string | undefined {
  return s.share_path;
}

async function copyText(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify(tr("share.copied"), "info");
  } catch {
    notify(tr("share.copyFailed"));
  }
}

/**
 * The share choices for a surface: private, or anyone with the link (a public copy at apxagent.app, reviewed first).
 * A live link from this computer is an advanced choice of its own, never called public.
 */
export function shareEntries(surface: SurfaceSummary, t: typeof tr): MenuEntry[] {
  void loadPublicCopies();
  const live = linkOf(surface);
  const copy = publicCopyOf(surface.id);
  const stop = () => copy && openPublicCopy({ action: "revoke", code: copy.code });
  return [
    {
      label: live || copy ? t("share.private") : `${t("share.private")} ✓`,
      description: t("share.privateHint"),
      icon: <Icons.Lock size={16} />,
      onSelect: () => {
        if (live) void shareSurface(surface.id, false);
        stop();
      },
    },
    {
      label: copy ? `${t("share.anyone")} ✓` : t("share.anyone"),
      ...(copy ? {} : { description: t("share.anyoneHint") }),
      icon: <Icons.Globe size={16} />,
      onSelect: () => {
        if (!copy) openPublicCopy({ action: "publish", surface: surface.id });
      },
    },
    ...(copy
      ? ([
          { type: "label", label: <span className="share__url">{copy.url}</span> },
          { label: t("share.copy"), icon: <Icons.Copy size={16} />, onSelect: () => copyText(copy.url) },
          {
            label: t("share.open"),
            icon: <Icons.ExternalLink size={16} />,
            onSelect: () => {
              window.open(copy.url, "_blank", "noopener,noreferrer");
            },
          },
          {
            label: t("share.update"),
            icon: <Icons.RefreshCw size={16} />,
            onSelect: () => openPublicCopy({ action: "update", code: copy.code, surface: surface.id }),
          },
          { label: t("share.stop"), icon: <Icons.EyeOff size={16} />, danger: true, onSelect: stop },
        ] satisfies MenuEntry[])
      : []),
    { type: "separator" },
    {
      label: live ? `${t("share.live")} ✓` : `${t("share.live")}…`,
      description: t("share.liveHint"),
      icon: <Icons.Monitor size={16} />,
      onSelect: () => {
        if (!live) openLiveLink(surface.id);
      },
    },
    ...(live
      ? ([
          { type: "label", label: <PublicLinkPreview path={live} /> },
          { type: "label", label: t("share.tunnelHint") },
          {
            label: t("share.liveCopy"),
            icon: <Icons.Copy size={16} />,
            onSelect: async () => {
              try {
                await copyText(await publicShareLink(live));
              } catch {
                notify(t("share.linkUnavailable"));
              }
            },
          },
          {
            label: t("share.liveOpen"),
            icon: <Icons.ExternalLink size={16} />,
            onSelect: async () => {
              try {
                await openPublicLink(
                  () => publicShareLink(live),
                  () => {
                    const tab = window.open("about:blank", "_blank");
                    if (!tab) return null;
                    tab.opener = null;
                    const policy = tab.document.createElement("meta");
                    policy.name = "referrer";
                    policy.content = "no-referrer";
                    tab.document.head.append(policy);
                    return { navigate: (value) => tab.location.replace(value), close: () => tab.close() };
                  },
                );
              } catch {
                notify(t("share.linkUnavailable"));
              }
            },
          },
          {
            label: t("share.liveOff"),
            icon: <Icons.EyeOff size={16} />,
            onSelect: () => void shareSurface(surface.id, false),
          },
        ] satisfies MenuEntry[])
      : []),
  ];
}

/** Turns on the live link once the owner read what it is, and copies it. */
export async function turnOnLiveLink(surface: string): Promise<void> {
  const path = await shareSurface(surface, true);
  if (!path) return;
  try {
    await copyText(await publicShareLink(path));
  } catch {
    notify(tr("share.linkUnavailable"));
  }
}

/** Private, anyone with the link (a public copy) or a live link from this computer, with copy/open of the link. */
export function ShareMenu({ surface, variant = "button" }: { surface: SurfaceSummary; variant?: "button" | "icon" }) {
  const t = useT();
  const copy = usePublicCopyOf(surface.id);
  const url = linkOf(surface) ?? copy?.url;
  const items = shareEntries(surface, t);
  const label = url ? t("share.shared") : t("share.private");
  const trigger =
    variant === "icon" ? (
      <IconButton
        size="sm"
        label={t("share.iconLabel", { state: label })}
        icon={url ? <Icons.Globe size={14} /> : <Icons.Share size={14} />}
        active={Boolean(url)}
      />
    ) : (
      <Button size="sm" variant="secondary" leadingIcon={url ? <Icons.Globe size={14} /> : <Icons.Lock size={14} />}>
        {url ? t("share.shared") : t("share.share")}
      </Button>
    );
  return <Menu align="end" items={items} trigger={trigger} />;
}
