import type { NewsEntry } from "./entries.ts";

export const PHONE_PRIVACY_NEWS: NewsEntry = {
  id: "phone-privacy",
  since: "2.18.1",
  title: { en: "Choose when your phone shares location", es: "Elegí cuándo comparte ubicación tu teléfono" },
  about: {
    en: "Choose location on request, trip location and anonymous usage statistics separately, from Android or your computer.",
    es: "Elegí por separado la ubicación a pedido, la de viajes y las estadísticas anónimas, desde Android o tu computadora.",
  },
  applies: (facts) => (facts.devices ?? 0) > 0,
  text: "Android Settings › Privacy and computer Settings › Advanced now share separate choices for location requested by agents, trip location, and anonymous usage statistics. Location choices apply to all phones on this APX; each phone still requires Android permission. Computer Settings › In the car has an overall errands switch and lists each phone; Android's switch changes only that phone. Errands are initially off. Turning off trip location also turns off errands, never the camera or pairing. Both the core and APK must be 2.18.1 or newer for the native trip service to stop remotely: it validates before GPS; a local stop is immediate and a remote stop reaches the phone at its next answer. If an active trip loses the connection, GPS stays on locally; positions reach APX again after reconnection, when a remote revocation also reaches the phone. A first check without an answer reads no coordinates. An older APK may keep using GPS while the updated core rejects positions. These are owner-only consent choices; show the settings rather than changing them yourself. Updating does not expand Android permissions or change the statistics consent. An upgraded phone without a current trip-consent revision requires local reactivation. The statistics choice does not stop installation lifecycle reports.",
  actions: [
    {
      label: { en: "Show my privacy choices", es: "Ver mis opciones de privacidad" },
      prompt:
        "Show me where I can choose phone location, errands and anonymous usage statistics, and explain what each switch changes without changing my choices.",
    },
  ],
};
