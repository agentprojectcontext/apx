// How the owner likes the lists on this phone, kept across launches. Secure storage is the one store the app has; a
// read that fails gives the default.
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const ROUTINES = "apx.view.routines";

/** Whether Chats lists the routine runs that told something (on unless the owner turned it off). */
export function useShowRoutines(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    SecureStore.getItemAsync(ROUTINES)
      .then((v) => setOn(v !== "off"))
      .catch(() => {});
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    SecureStore.setItemAsync(ROUTINES, next ? "on" : "off").catch(() => {});
  }, []);
  return [on, set];
}
