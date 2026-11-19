import { ConnectSignal, type ConnectSignalState, GoogleMark } from "@apx/ui";
import type { ReactNode } from "react";
import { ApxMark } from "../marketplace/ConnectHead.tsx";

/** APX joined to Google by the connect dots: signing in to the APX account, wherever it starts or ends. */
export function GoogleSignal({ state, label }: { state: ConnectSignalState; label?: ReactNode }) {
  return <ConnectSignal from={<ApxMark />} to={<GoogleMark size={28} />} state={state} label={label} />;
}
