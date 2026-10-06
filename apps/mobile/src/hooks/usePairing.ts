import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { type Creds, saveCreds } from "../creds";
import { t } from "../i18n";
import { firstReachable, parsePairingLink } from "../pairing";
import { ApxClient, ApxError } from "../protocol";

export function usePairing(link: string | undefined, onPaired: (creds: Creds) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const consumedLink = useRef<string | undefined>(undefined);
  const pair = useCallback(
    async (urls: string[], code: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        const reachable = await firstReachable(urls);
        if (!reachable) {
          setError(t("unreachable"));
          return;
        }
        const client = new ApxClient({ url: reachable, client: { name: "apx-mobile", version: "2.0.2" } });
        const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other";
        const name = Platform.OS === "android" ? Platform.constants.Model : Platform.OS === "ios" ? "iPhone" : "Phone";
        const result = await client.call("devices.pair", { code: code.trim(), name, platform });
        const creds = { url: reachable, token: result.token, device: result.device.id };
        await saveCreds(creds);
        onPaired(creds);
      } catch (error) {
        setError(
          error instanceof ApxError && error.code === "unauthorized"
            ? t(/too many/i.test(error.message) ? "lockedCode" : "badCode")
            : t("failed", { error: error instanceof Error ? error.message : String(error) }),
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [onPaired],
  );
  useEffect(() => {
    if (!link || consumedLink.current === link) return;
    consumedLink.current = link;
    const parsed = parsePairingLink(link);
    if (parsed) void pair(parsed.urls, parsed.code);
  }, [link, pair]);
  return { busy, error, pair };
}
