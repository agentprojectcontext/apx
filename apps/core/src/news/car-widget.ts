import type { NewsEntry } from "./entries.ts";

export const CAR_WIDGET_NEWS: NewsEntry = {
  id: "car-phone-widget",
  since: "2.18.1",
  title: { en: "Keep errands on your home screen", es: "Tené los recados en la pantalla de inicio" },
  about: {
    en: "Add the Android widget to see the errand APX offers on your way, and manage each phone separately from your computer.",
    es: "Agregá el widget de Android para ver el recado que APX ofrece en tu camino y controlá cada teléfono por separado desde la computadora.",
  },
  applies: (facts) => facts.androidPhone === true,
  text: "Android now has an APX home-screen widget for the next errand offered on the way. Help the owner add it through Android's home-screen widget picker; APX cannot add it silently. Settings › In the car on the computer lists the phones, so the owner can turn one off without changing the others. Android's errands switch changes only that phone; the computer also keeps the overall errands choice. A network interruption no longer ends an active trip: the phone keeps its local GPS but sends nothing while the core is unreachable. A remote stop made offline reaches the phone when it reconnects. Local stop still stops that phone immediately. These controls do not change pairing or camera permission.",
  actions: [
    {
      label: { en: "Add the errands widget", es: "Agregar el widget de recados" },
      prompt: "Walk me through adding the APX errands widget on my Android phone without changing my privacy choices.",
    },
  ],
};
