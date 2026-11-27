import { ChannelIcon, ConnectSignal, Icons, IntegrationIcon } from "@apx/ui";
import { useState } from "react";
import logoUrl from "../assets/logo.png";
import type { Item } from "../resources/extensionItems.ts";
import { iconFiles } from "./brand.ts";
import { useAsset } from "./useAsset.ts";
import "@apx/ui/summary.css";
import "../styles/install-box.css";

export type LinkState = "idle" | "connecting" | "connected" | "broken";

/** The catalog or package mark, a built-in service mark, or a neutral puzzle. */
export function ItemIcon({
  item,
  size,
}: {
  item: Pick<Item, "id" | "name"> &
    Partial<Pick<Item, "listing" | "channel" | "builtin" | "entry" | "ext" | "integration">>;
  size: number;
}) {
  const { file, fallback, revision } = iconFiles(item);
  const [broken, setBroken] = useState<{ identity: string; urls: string[] }>();
  const identity = JSON.stringify([item.id, file, revision]);
  const failures = broken?.identity === identity ? broken.urls : [];
  const icon = useAsset(item.id, failures.length ? fallback : file, revision, fallback);
  if (item.channel)
    return (
      <span className="mkt__tile" style={{ width: size, height: size }}>
        <ChannelIcon channel={item.channel} size={Math.round(size * 0.6)} />
      </span>
    );
  if (item.builtin === "browser")
    return (
      <span className="mkt__tile" style={{ width: size, height: size }}>
        <Icons.Globe size={Math.round(size * 0.55)} />
      </span>
    );
  return icon && !failures.includes(icon) ? (
    <img
      className="mkt__icon"
      src={icon}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setBroken({ identity, urls: [...failures, icon] })}
    />
  ) : item.integration && !item.entry && !item.ext ? (
    <IntegrationIcon id={item.id} name={item.name} size={size} />
  ) : (
    <span className="mkt__tile" style={{ width: size, height: size }} aria-hidden="true">
      <Icons.Puzzle size={Math.round(size * 0.55)} />
    </span>
  );
}

/** APX's own mark, at the APX end of a link. */
export const ApxMark = () => <img className="mkt-box__apx" src={logoUrl} alt="" width={30} height={30} />;

/** The head of an included account's connect form: APX joined to the service, as in the add box. */
export function ConnectHead({
  item,
  from = "apx",
  state,
}: {
  item: Pick<Item, "id" | "name"> & Partial<Pick<Item, "listing" | "entry" | "ext">>;
  /** Where the link starts: APX (an account) or the app (a companion app pairing with APX). */
  from?: "apx" | "app";
  state: LinkState;
}) {
  const app = <ItemIcon item={item} size={36} />;
  return (
    <ConnectSignal from={from === "apx" ? <ApxMark /> : app} to={from === "apx" ? app : <ApxMark />} state={state} />
  );
}
