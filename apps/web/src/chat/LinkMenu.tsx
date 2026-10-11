import { ContextMenu, Icons, type LinkRenderer, type MenuEntry } from "@apx/ui";
import { browserOpen } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { openOutside, useInstalledBrowsers } from "../panel/browserWindow.ts";
import { go, nav } from "../shell/nav.ts";

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

export const linkMenu: LinkRenderer = (href, link) => <LinkMenu href={href}>{link}</LinkMenu>;
