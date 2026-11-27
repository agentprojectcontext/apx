import { fireEvent, render } from "@testing-library/react-native";
import { lang, t, translator } from "../src/i18n";
import { type Message, noticeText } from "../src/protocol";
import { ActionGroup } from "../src/ui/ActionGroup";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const message: Message = {
  id: "m",
  thread_id: "th",
  seq: 1,
  author: { kind: "agent", id: "agent" },
  created_at: "2026-11-26T10:00:00Z",
  parts: [
    { type: "tool", tool: "remember", call_id: "c1", status: "ok", title: "Save preferences" },
    {
      type: "notice",
      code: "memory.saved",
      level: "info",
      text: "Saved to memory",
      detail: "First complete note\n".repeat(8),
      vars: { call: "c1" },
    },
    { type: "text", text: "The report is ready." },
    { type: "notice", code: "memory.saved", level: "info", text: "Saved to memory", detail: "Second complete note" },
    {
      type: "notice",
      code: "research.updated",
      level: "info",
      text: "Research updated",
      vars: { interests: "Design\nTesting", places: "Acme office" },
    },
  ],
};
const memory = noticeText({ code: "memory.saved", text: "Saved to memory" }, lang);
const research = noticeText({ code: "research.updated", text: "Research updated" }, lang);

test.each(["working", "completed"])(
  "%s answers group chips in place with all their saved content",
  async (runState) => {
    const ui = await render(<ChatMessage message={message} agents={[]} respond={async () => {}} runState={runState} />);
    expect(ui.getAllByText(memory)).toHaveLength(1);
    expect(ui.queryByText("Second complete note")).toBeNull();
    expect(ui.queryByText(t("actionsOne"))).toBeNull();
    await fireEvent.press(ui.getByRole("button", { name: memory }));
    expect(ui.getByText("First complete note\n".repeat(8))).toBeTruthy();
    expect(ui.getByText("Second complete note")).toBeTruthy();
    const tree = JSON.stringify(ui.toJSON());
    expect(tree.indexOf("Second complete note")).toBeLessThan(tree.indexOf("The report is ready."));
    await fireEvent.press(ui.getByRole("button", { name: research }));
    expect(ui.getByText(t("researchInterest", { value: "Testing" }))).toBeTruthy();
    expect(ui.getByText(t("researchPlace", { value: "Acme office" }))).toBeTruthy();
  },
);

test("failed matching calls are not hidden by a saved chip", async () => {
  const failed = message.parts.map((p) =>
    p.type === "tool" ? { ...p, status: "error" as const, detail: "Could not save" } : p,
  );
  const ui = await render(<ChatMessage message={{ ...message, parts: failed }} agents={[]} respond={async () => {}} />);
  expect(ui.getByText(t("actionsFailed", { n: 1 }))).toBeTruthy();
});

test("action rows expose their state, kind and full detail without raw tool labels", async () => {
  const parts = [
    { type: "tool" as const, tool: "web_read", call_id: "web", status: "ok" as const, title: "Read the reference" },
    {
      type: "tool" as const,
      tool: "shell",
      call_id: "cmd",
      status: "error" as const,
      title: "Run the checks",
      detail: "Complete error output\n".repeat(9),
    },
  ];
  const ui = await render(<ActionGroup parts={parts} ended />);
  expect(ui.getByText(t("actionsFailed", { n: 1 }))).toBeTruthy();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText("web_read")).toBeNull();
  expect(ui.getByText("Read the reference")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: `Run the checks, ${t("runFailed")}` }));
  expect(ui.getByText(parts[1]?.detail ?? "")).toBeTruthy();
});

test("English and Spanish distinguish one failure from many and keep progress readable", () => {
  expect(translator("es")("actionsFailed", { n: 1 })).toBe("· 1 falló");
  expect(translator("es")("actionsFailed", { n: 2 })).toBe("· 2 fallaron");
  expect(translator("en")("actionsFailed", { n: 1 })).toBe("· 1 failed");
  expect(translator("es")("planDone", { done: 1, count: 3 })).toBe("1 de 3 hechos");
});
