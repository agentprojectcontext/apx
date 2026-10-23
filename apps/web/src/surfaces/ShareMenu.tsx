import type { SurfaceSummary } from "@apx/protocol";
import { Button, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { shareSurface } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { t as tr, useT } from "../i18n/index.ts";

export function linkOf(s: SurfaceSummary): string | undefined {
  return s.share_path ? `${window.location.origin}${s.share_path}` : undefined;
}

async function copy(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify(tr("share.copied"), "info");
  } catch {
    notify(tr("share.copyFailed"));
  }
}

/** The share choices for a surface: private or public link, and copy/open of the link once public. */
export function shareEntries(surface: SurfaceSummary, t: typeof tr): MenuEntry[] {
  const url = linkOf(surface);
  return [
    { type: "label", label: t("share.hint") },
    {
      label: url ? t("share.private") : `${t("share.private")} ✓`,
      icon: <Icons.Lock size={16} />,
      onSelect: () => url && void shareSurface(surface.id, false),
    },
    {
      label: url ? `${t("share.anyone")} ✓` : t("share.anyone"),
      icon: <Icons.Globe size={16} />,
      onSelect: async () => {
        if (url) return;
        const path = await shareSurface(surface.id, true);
        if (path) void copy(`${window.location.origin}${path}`);
      },
    },
    ...(url
      ? ([
          { type: "separator" },
          { type: "label", label: <span className="share__url">{url}</span> },
          { label: t("share.copy"), icon: <Icons.Copy size={16} />, onSelect: () => void copy(url) },
          {
            label: t("share.open"),
            icon: <Icons.ExternalLink size={16} />,
            onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
          },
        ] satisfies MenuEntry[])
      : []),
  ];
}

/** Private ↔ public link for a surface (surfaces.share), with copy/open of the link. */
export function ShareMenu({ surface, variant = "button" }: { surface: SurfaceSummary; variant?: "button" | "icon" }) {
  const t = useT();
  const url = linkOf(surface);
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
