import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { t } from "../i18n";
import type { NoticePrefs } from "../protocol";

export function useNoticePrefs(load: () => Promise<NoticePrefs>, save: (prefs: NoticePrefs) => Promise<NoticePrefs>) {
  const scope = useMemo(
    () => ({ active: false, request: 0, confirmed: 0, saved: undefined as NoticePrefs | undefined, load, save }),
    [load, save],
  );
  const [loaded, setLoaded] = useState<{ scope: typeof scope; value: NoticePrefs }>();
  const prefs = loaded?.scope === scope ? loaded.value : undefined;
  useEffect(() => {
    scope.active = true;
    const version = scope.request;
    void scope
      .load()
      .then((value) => {
        if (!scope.active || version !== scope.request) return;
        scope.saved = value;
        setLoaded({ scope, value });
      })
      .catch(() => undefined);
    return () => {
      scope.active = false;
      scope.request++;
    };
  }, [scope]);
  const change = useCallback(
    (patch: Partial<NoticePrefs>) => {
      if (!prefs || !scope.active) return;
      const next = { ...prefs, ...patch };
      const mine = ++scope.request;
      setLoaded({ scope, value: next });
      void scope
        .save(next)
        .then((value) => {
          if (!scope.active) return;
          if (mine > scope.confirmed) {
            scope.confirmed = mine;
            scope.saved = value;
          }
          if (mine === scope.request) setLoaded({ scope, value });
        })
        .catch((error: unknown) => {
          if (!scope.active) return;
          if (mine === scope.request) setLoaded({ scope, value: scope.saved ?? prefs });
          Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
        });
    },
    [prefs, scope],
  );
  return { prefs, change };
}
