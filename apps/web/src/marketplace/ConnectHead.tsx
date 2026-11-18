import { ChannelIcon, ConnectSignal, Icons, IntegrationIcon } from "@apx/ui";
import logoUrl from "../assets/logo.png";
import type { Item } from "../resources/extensionItems.ts";
import { useAsset } from "./useAsset.ts";
import "@apx/ui/summary.css";
import "../styles/install-box.css";

// An extension's mark (its own icon, a channel's, the browser's, or its letter), and the head of a connect form: APX
// joined to the service by dots that move while it connects (packages/ui ConnectSignal).

export type LinkState = "idle" | "connecting" | "connected" | "broken";

/** An extension's own icon when its listing has one; a channel's or the browser's mark; else the app's mark or its letter. */
export function ItemIcon({
  item,
  size,
}: {
  item: Pick<Item, "id" | "name"> & Partial<Pick<Item, "listing" | "channel" | "builtin" | "entry">>;
  size: number;
}) {
  // Its package's icon once read; until then the one the catalog's index points at.
  const icon = useAsset(item.id, item.listing?.icon ?? (item.entry?.icon_url ? "@icon" : undefined));
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
  return icon ? (
    <img className="mkt__icon" src={icon} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <IntegrationIcon id={item.id} name={item.name} size={size} />
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
  item: Pick<Item, "id" | "name"> & Partial<Pick<Item, "listing" | "entry">>;
  /** Where the link starts: APX (an account) or the app (a companion app pairing with APX). */
  from?: "apx" | "app";
  state: LinkState;
}) {
  const app = <ItemIcon item={item} size={36} />;
  return (
    <ConnectSignal from={from === "apx" ? <ApxMark /> : app} to={from === "apx" ? app : <ApxMark />} state={state} />
  );
}
