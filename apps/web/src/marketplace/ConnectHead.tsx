import { ChannelIcon, Icons, IntegrationIcon } from "@apx/ui";
import type { ReactNode } from "react";
import logoUrl from "../assets/logo.png";
import type { Item } from "../resources/extensionItems.ts";
import { useAsset } from "./useAsset.ts";
import "../styles/connect-link.css";

// The top of a connect dialog: two logos joined by dots. An account goes from APX to the service; a companion app
// from the app to APX. The dots move while it connects, turn solid once connected, and stay still when it broke.

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

const ApxTile = () => (
  <span className="mkt-link__tile">
    <img src={logoUrl} alt="APX" width={28} height={28} />
  </span>
);

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
  const app: ReactNode = (
    <span className="mkt-link__tile mkt-link__tile--target">
      <ItemIcon item={item} size={36} />
    </span>
  );
  return (
    <div className={`mkt-link mkt-link--${state}`} aria-hidden="true">
      {from === "apx" ? <ApxTile /> : app}
      <span className="mkt-link__dots">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {from === "apx" ? app : <ApxTile />}
    </div>
  );
}
