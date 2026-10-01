import { Icons, Menu, type MenuEntry } from "@apx/ui";
import { initialsOf, usePrefs } from "../data/prefs.ts";
import { go, useNav } from "./nav.ts";

/** Sidebar footer: who is using the panel, with quick theme / language / phone / config actions. */
export function AccountRow({ rail }: { rail: boolean }) {
  const name = usePrefs((s) => s.displayName);
  const mode = useNav((s) => s.mode);
  const items: MenuEntry[] = [
    { type: "label", label: name },
    { label: "Perfil y cuenta", icon: <Icons.User />, onSelect: () => go.config("account") },
    {
      label: mode === "dark" ? "Modo claro" : "Modo oscuro",
      icon: mode === "dark" ? <Icons.Sun /> : <Icons.Moon />,
      onSelect: go.toggleMode,
    },
    { label: "Idioma", icon: <Icons.Languages />, shortcut: "ES", onSelect: () => go.config("appearance") },
    { label: "Abrir en el teléfono", icon: <Icons.Smartphone />, onSelect: () => go.phone(true) },
    { type: "separator" },
    { label: "Configuración", icon: <Icons.Settings />, shortcut: "⌘,", onSelect: () => go.config() },
  ];
  return (
    <div className={rail ? "account is-rail" : "account"}>
      <Menu
        side="top"
        align="start"
        items={items}
        trigger={
          <button type="button" className="account__btn" aria-label={`Cuenta de ${name}`}>
            <span className="account__avatar" aria-hidden="true">
              {initialsOf(name)}
            </span>
            {!rail && (
              <>
                <span className="account__name">{name}</span>
                <Icons.Ellipsis size={16} className="account__more" />
              </>
            )}
          </button>
        }
      />
    </div>
  );
}
