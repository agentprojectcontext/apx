import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionGroup,
  ApxProvider,
  BrowserTabs,
  Checkbox,
  Composer,
  DatePicker,
  Dialog,
  Menu,
  ResizeHandle,
  SegmentedControl,
  Select,
  SuggestTextarea,
  Switch,
  TagInput,
} from "../dist/index.js";
import { LifecycleFixture } from "./lifecycle.test-support.ts";

function Fixture() {
  const [tags, setTags] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState<string>();
  const [width, setWidth] = useState(240);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("a");
  const [tabs, setTabs] = useState([
    { id: "a", title: "Acme" },
    { id: "b", title: "Northwind" },
  ]);
  const [events, setEvents] = useState<unknown[]>([]);
  const record = (event: unknown) => setEvents((old) => [...old, event]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(false);
  return h(
    ApxProvider,
    {},
    h(
      "main",
      {},
      h("output", { "data-testid": "events" }, JSON.stringify(events)),
      h("output", { "data-testid": "tags" }, JSON.stringify(tags)),
      h(TagInput, { label: "Tags", value: tags, onValueChange: setTags, max: 3 }),
      h(SuggestTextarea, {
        "aria-label": "Command",
        value: suggestion,
        onValueChange: setSuggestion,
        suggestions: [
          { insert: "$APX_HOME", hint: "Home" },
          { insert: "$APX_PORT", hint: "Port" },
        ],
      }),
      h(Select, {
        label: "Project",
        placeholder: "Choose a project",
        value: selected,
        onValueChange: setSelected,
        options: [
          { value: "a", label: "Acme", group: "Active", description: "First project" },
          { value: "b", label: "Northwind", group: "Active", hint: "Paused", disabled: true },
          { value: "c", label: "Personal" },
        ],
      }),
      h("output", { "data-testid": "selected" }, selected),
      h(Checkbox, { label: "Select all", checked, onCheckedChange: setChecked }),
      h(Switch, { label: "Notifications", checked: on, onCheckedChange: setOn }),
      h(Switch, { label: "Locked", checked: true, disabled: true }),
      h(SegmentedControl, {
        label: "View",
        options: [
          { value: "list", label: "List" },
          { value: "board", label: "Board" },
        ],
        onValueChange: (v: string) => record({ view: v }),
      }),
      h(Composer, {
        inputLabel: "Message",
        onSubmit: (text: string, opts: { queue: boolean }) => record({ text, ...opts }),
        onVoice: () => record("voice"),
        onAttach: () => record("attach"),
        busy,
        onStop: () => {
          record("stop");
          setBusy(false);
        },
      }),
      h("button", { type: "button", onClick: () => setBusy(true) }, "Start run"),
      h(Composer, {
        inputLabel: "Attachment message",
        ready: true,
        labels: { send: "Send attachment" },
        onSubmit: (text: string) => record({ attachment: text }),
      }),
      h(DatePicker, {
        label: "Due date",
        value: date,
        onValueChange: setDate,
        locale: "en-US",
        presets: [{ label: "Leap day", value: "2024-02-29" }],
      }),
      h("output", { "data-testid": "date" }, date ?? "None"),
      h(
        "div",
        { style: { position: "relative", width: 240, height: 100 } },
        h(ResizeHandle, {
          label: "Resize sidebar",
          width,
          min: 200,
          max: 300,
          onResize: setWidth,
          onDragChange: setDragging,
          onReset: () => setWidth(240),
        }),
      ),
      h("output", { "data-testid": "dragging" }, String(dragging)),
      h(BrowserTabs, {
        tabs,
        value: tab,
        onValueChange: setTab,
        onClose: (id: string) => setTabs((old) => old.filter((t) => t.id !== id)),
        onNew: () => setTabs((old) => [...old, { id: "c", title: "New page" }]),
      }),
      h("output", { "data-testid": "tab" }, tab),
      h(Menu, {
        trigger: h("button", { type: "button" }, "Actions"),
        items: [
          { label: "Archive", onSelect: () => record("archive") },
          { label: "Unavailable", disabled: true, onSelect: () => record("disabled") },
        ],
      }),
      h(
        Dialog,
        {
          trigger: h("button", { type: "button" }, "Edit project"),
          title: "Project details",
          description: "Changes stay local",
        },
        h("input", { "aria-label": "Project name", defaultValue: "Acme" }),
      ),
      h(LifecycleFixture),
      h(ActionGroup, {
        title: "Worked",
        failed: 1,
        items: [
          { name: "Read", detail: "Done" },
          { name: "Write", status: "failed", detail: "Refused" },
        ],
      }),
    ),
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(h(Fixture));
