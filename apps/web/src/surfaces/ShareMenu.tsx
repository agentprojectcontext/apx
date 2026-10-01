import type { SurfaceSummary } from "@apx/protocol";
import { Button, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { shareSurface } from "../data/actions.ts";
import { notify } from "../data/notices.ts";

function linkOf(s: SurfaceSummary): string | undefined {
  return s.share_path ? `${window.location.origin}${s.share_path}` : undefined;
}

async function copy(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify("Enlace copiado.", "info");
  } catch {
    notify("No se pudo copiar el enlace.");
  }
}

/** Private ↔ public link for a surface (surfaces.share), with copy/open of the link. */
export function ShareMenu({ surface, variant = "button" }: { surface: SurfaceSummary; variant?: "button" | "icon" }) {
  const url = linkOf(surface);
  const items: MenuEntry[] = [
    { type: "label", label: "Privado por defecto. Con enlace, cualquiera lo ve sin editar." },
    {
      label: url ? "Privado" : "Privado ✓",
      icon: <Icons.Lock size={16} />,
      onSelect: () => url && void shareSurface(surface.id, false),
    },
    {
      label: url ? "Cualquiera con el enlace ✓" : "Cualquiera con el enlace",
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
          { label: "Copiar enlace", icon: <Icons.Copy size={16} />, onSelect: () => void copy(url) },
          {
            label: "Abrir enlace",
            icon: <Icons.ExternalLink size={16} />,
            onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
          },
        ] satisfies MenuEntry[])
      : []),
  ];
  const label = url ? "Compartido" : "Privado";
  const trigger =
    variant === "icon" ? (
      <IconButton
        size="sm"
        label={`Compartir · ${label}`}
        icon={url ? <Icons.Globe size={14} /> : <Icons.Share size={14} />}
        active={Boolean(url)}
      />
    ) : (
      <Button size="sm" variant="secondary" leadingIcon={url ? <Icons.Globe size={14} /> : <Icons.Lock size={14} />}>
        {url ? "Compartido" : "Compartir"}
      </Button>
    );
  return <Menu align="end" items={items} trigger={trigger} />;
}
