import { Avatar, Button, GoogleMark, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useEffect, useState } from "react";
import type { Person } from "./account.ts";
import type { Texts } from "./texts.ts";

type BarProps = {
  t: Texts;
  title?: string;
  usable: boolean;
  downloading: boolean;
  owner: boolean;
  person?: Person;
  signIn?: { busy: boolean; start(): void; prepare(): void; out(): void };
  onOpen(): void;
  onDownload(): void;
  onCopyLink(): void;
  onStop(): void;
  onLanguage(): void;
};

/** On a phone the bar keeps only the name and who is signed in; its buttons move into the menu. */
function useNarrow() {
  const query = "(max-width: 600px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return narrow;
}

/** One slim bar: APX's mark, the copy's name opening what can be done with it, and opening it in APX at hand. */
export function Bar({ t, title, usable, downloading, owner, person, signIn, ...on }: BarProps) {
  const narrow = useNarrow();
  const getApx = () => window.open(t.getApxUrl, "_blank", "noopener");
  const file: MenuEntry = {
    label: downloading ? t.downloading : t.file,
    description: owner ? undefined : t.hint,
    icon: <Icons.Download size={16} />,
    disabled: !usable,
    onSelect: on.onDownload,
  };
  const actions: MenuEntry[] = owner
    ? [
        { label: t.copyLink, icon: <Icons.Link size={16} />, onSelect: on.onCopyLink },
        {
          label: t.edit,
          description: t.editHint,
          icon: <Icons.Pencil size={16} />,
          disabled: !usable,
          onSelect: on.onOpen,
        },
        file,
        { label: t.stop, icon: <Icons.Lock size={16} />, danger: true, onSelect: on.onStop },
      ]
    : [
        { label: t.open, icon: <Icons.ExternalLink size={16} />, disabled: !usable, onSelect: on.onOpen },
        file,
        ...(narrow ? [{ label: t.getApx, icon: <Icons.Monitor size={16} />, onSelect: getApx }] : []),
      ];
  const account: MenuEntry[] = !signIn
    ? []
    : person
      ? [
          {
            type: "label",
            label: (
              <span className="public-copy__who">
                <Avatar name={person.name || person.email} src={person.photo} size={24} />
                <span>
                  <span className="public-copy__email">{person.email || person.name}</span>
                  {owner && <span className="public-copy__yours">{t.yours}</span>}
                </span>
              </span>
            ),
          },
          { label: t.signOut, icon: <Icons.LogOut size={16} />, onSelect: signIn.out },
        ]
      : [
          {
            label: signIn.busy ? t.signingIn : t.signIn,
            icon: <GoogleMark size={16} />,
            disabled: signIn.busy,
            onSelect: signIn.start,
          },
        ];
  return (
    <header className="public-copy__bar">
      <div className="public-copy__start">
        <a className="public-copy__mark" href="https://apxagent.app" aria-label={t.home}>
          <img src="/logo.svg" alt="" width={22} height={22} />
        </a>
        <Menu
          align="start"
          onOpenChange={(open) => open && signIn?.prepare()}
          trigger={
            <button type="button" className="public-copy__title" aria-label={t.options}>
              <span className="public-copy__name">{title ?? t.published}</span>
              <Icons.ChevronDown size={16} />
            </button>
          }
          items={[
            ...actions,
            { type: "separator" },
            ...account,
            { label: t.language, icon: <Icons.Languages size={16} />, onSelect: on.onLanguage },
          ]}
        />
      </div>
      <div className="public-copy__end">
        {title && !narrow && (
          <Button size="sm" disabled={!usable} onClick={on.onOpen}>
            {owner ? t.edit : t.open}
          </Button>
        )}
        {!owner && !narrow && (
          <Button size="sm" variant="ghost" className="public-copy__get" onClick={getApx}>
            {t.getApx}
          </Button>
        )}
        {person && <Avatar name={person.name || person.email} src={person.photo} size={28} />}
      </div>
    </header>
  );
}
