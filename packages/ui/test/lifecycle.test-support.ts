import { createElement as h, useState } from "react";
import { DateRangePicker, MasterDetail, VoiceNote } from "../dist/index.js";

export function LifecycleFixture() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({ from: "2024-02-10" });
  const [src, setSrc] = useState<string>();
  const [mounted, setMounted] = useState(true);
  return h(
    "section",
    {},
    h(DateRangePicker, {
      label: "Date range",
      value: range,
      onValueChange: setRange,
      locale: "en-US",
      labels: { prevMonth: "Previous month", nextMonth: "Next month" },
    }),
    h("output", { "data-testid": "range" }, JSON.stringify(range)),
    h("button", { type: "button", onClick: () => setSrc("http://media.test/one.wav") }, "Load voice"),
    h("button", { type: "button", onClick: () => setSrc("http://media.test/two.wav") }, "Replace voice"),
    h("button", { type: "button", onClick: () => setMounted(false) }, "Remove voice"),
    mounted && h(VoiceNote, { src, duration: 120, label: "Recording" }),
    h(
      "div",
      { style: { height: 200 } },
      h(MasterDetail, {
        resizeKey: "coverage-fixture",
        listLabel: "Resource width",
        list: "Resources",
        empty: "Choose a resource",
      }),
    ),
  );
}
