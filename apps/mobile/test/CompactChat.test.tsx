import { fireEvent, render } from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { ActionGroup } from "../src/ui/ActionGroup";
import { ChatMessage } from "../src/ui/ChatMessage";
import { NoticeCard } from "../src/ui/chat/NoticeCard";
import { PlanCard } from "../src/ui/chat/PlanCard";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));

jest.mock("../src/ui/Icon", () => {
  const { View } = jest.requireActual("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  Dimensions.set({ window: { width: 390, height: 844, scale: 1, fontScale: 1 } });
});

afterEach(() => jest.restoreAllMocks());

test("context summaries are static compact notices, not disclosure controls", async () => {
  const text = "Earlier turns were summarized without starting a new conversation.";
  const detail = "Complete context detail\n".repeat(12);
  const ui = await render(
    <NoticeCard part={{ type: "notice", code: "thread.compacted", level: "info", text, detail }} />,
  );
  expect(ui.queryByText(detail)).toBeNull();
  expect(ui.getByText(t("noticeContext"))).toBeTruthy();
  expect(ui.queryByRole("button")).toBeNull();
  await ui.rerender(<NoticeCard part={{ type: "notice", code: "thread.compacted", level: "info", text }} />);
  expect(ui.getByText(t("noticeContext"))).toBeTruthy();
  expect(ui.queryByRole("button")).toBeNull();
});

test("chat plans fold by default, retain steps when opened and update progress live", async () => {
  const steps = [
    { step: "Read the brief", state: "pending" },
    { step: "Compare options", state: "pending" },
    { step: "Write the result", state: "pending" },
  ] as Extract<Message["parts"][number], { type: "plan" }>["steps"];
  const ui = await render(<PlanCard label={t("plan")} steps={steps} collapsible />);
  expect(ui.getByText(t("planDone", { done: 0, count: 3 }))).toBeTruthy();
  expect(ui.queryByText("Read the brief")).toBeNull();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getByText("Compare options")).toBeTruthy();
  expect(ui.getByLabelText(`Compare options, ${t("planPending")}`)).toBeTruthy();
  await ui.rerender(
    <PlanCard
      label={t("plan")}
      steps={steps.map((s, i) => (i === 0 ? { ...s, state: "done" } : i === 1 ? { ...s, state: "doing" } : s))}
      collapsible
    />,
  );
  expect(ui.getByText(t("planDone", { done: 1, count: 3 }))).toBeTruthy();
  expect(ui.getByLabelText(`Read the brief, ${t("runDone")}`)).toBeTruthy();
  expect(ui.getByLabelText(`Compare options, ${t("runWorking")}`)).toBeTruthy();
  expect(ui.getByLabelText(`Write the result, ${t("planPending")}`)).toBeTruthy();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText("Read the brief")).toBeNull();
  await ui.rerender(<PlanCard label={t("plan")} steps={steps.map((s) => ({ ...s, state: "done" }))} collapsible />);
  expect(ui.getByText(t("planDone", { done: 3, count: 3 }))).toBeTruthy();
});

test("memory remains compact and discloses the complete saved content", async () => {
  const detail = "Complete memory content\n".repeat(12);
  const ui = await render(
    <NoticeCard part={{ type: "notice", code: "memory.saved", level: "info", text: "Saved to memory", detail }} />,
  );
  const row = ui.getByRole("button");
  expect(StyleSheet.flatten(row.props.style).minHeight).toBe(34);
  expect(row.props.accessibilityState.expanded).toBe(false);
  expect(ui.getByTestId("icon-ChevronRight")).toBeTruthy();
  await fireEvent.press(row);
  expect(ui.getByText(detail)).toBeTruthy();
  expect(ui.getAllByText("Saved to memory")).toHaveLength(1);
  expect(ui.getByRole("button").props.accessibilityState.expanded).toBe(true);
  expect(ui.getByTestId("icon-ChevronDown")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText(detail)).toBeNull();
});

test("action groups and each step show matching chevrons without tall row gaps", async () => {
  const ui = await render(
    <ActionGroup
      parts={[
        {
          type: "tool",
          call_id: "one",
          tool: "task_get",
          title: "Read a task",
          status: "ok",
          detail: "Complete task detail",
        },
        {
          type: "tool",
          call_id: "two",
          tool: "shell",
          title: "Run a command",
          status: "error",
          detail: "Full error detail",
        },
      ]}
    />,
  );
  expect(ui.getByTestId("icon-ChevronRight")).toBeTruthy();
  expect(ui.queryByTestId("icon-ChevronDown")).toBeNull();
  await fireEvent.press(ui.getByRole("button"));
  const controls = ui.getAllByRole("button");
  expect(controls).toHaveLength(3);
  expect(controls.map((row) => row.props.accessibilityState.expanded)).toEqual([true, false, false]);
  expect(controls.map((row) => StyleSheet.flatten(row.props.style).minHeight)).toEqual([34, 32, 32]);
  expect(ui.getAllByTestId("icon-ChevronRight")).toHaveLength(2);
  const firstStep = controls[1];
  if (!firstStep) throw new Error("Missing first step");
  await fireEvent.press(firstStep);
  expect(ui.getByText("Complete task detail")).toBeTruthy();
  expect(ui.getAllByTestId("icon-ChevronDown")).toHaveLength(2);
  const secondStep = ui.getAllByRole("button")[2];
  if (!secondStep) throw new Error("Missing second step");
  await fireEvent.press(secondStep);
  expect(ui.queryByText("Complete task detail")).toBeNull();
  expect(ui.getByText("Full error detail")).toBeTruthy();
});

test.each(["screen reader", "large text"])("nested action targets remain roomy for %s", async (mode) => {
  if (mode === "screen reader") jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  else Dimensions.set({ window: { width: 390, height: 844, scale: 1, fontScale: 1.35 } });
  const ui = await render(
    <ActionGroup
      parts={[
        {
          type: "tool",
          call_id: "one",
          tool: "file_read",
          title: "Read the reference",
          status: "ok",
          detail: "Complete reference",
        },
      ]}
    />,
  );
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getAllByRole("button").map((row) => StyleSheet.flatten(row.props.style).minHeight)).toEqual([48, 48]);
  const action = ui.getAllByRole("button")[1];
  if (!action) throw new Error("Missing nested action");
  await fireEvent.press(action);
  expect(ui.getByText("Complete reference")).toBeTruthy();
});

test("steps without supporting detail stay static and do not truncate their label", async () => {
  const title = "Read the complete reference without hiding any of its title";
  const ui = await render(
    <ActionGroup
      parts={[
        { type: "tool", call_id: "static", tool: "file_read", title, status: "ok" },
        { type: "tool", call_id: "blank", tool: "shell", title: "Blank detail", status: "ok", detail: "  " },
      ]}
    />,
  );
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getAllByRole("button")).toHaveLength(1);
  expect(ui.queryByTestId("icon-ChevronRight")).toBeNull();
  expect(ui.getByText(title).props.numberOfLines).toBeUndefined();
  for (const label of [title, "Blank detail"]) {
    const row = ui.getByLabelText(`${label}, ${t("runDone")}`);
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityRole).toBe("text");
    expect(row.props.accessibilityState).toBeUndefined();
    expect(row.props.onClick).toBeUndefined();
    expect(row.props.onStartShouldSetResponder).toBeUndefined();
  }
});

test.each(["screen reader", "large text"])("compact controls retain full touch targets for %s", async (mode) => {
  if (mode === "screen reader") jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  else Dimensions.set({ window: { width: 390, height: 844, scale: 1, fontScale: 1.35 } });
  const ui = await render(
    <NoticeCard
      part={{ type: "notice", code: "memory.saved", level: "info", text: "Saved to memory", detail: "Full detail" }}
    />,
  );
  expect(StyleSheet.flatten(ui.getByRole("button").props.style).minHeight).toBe(48);
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getByText("Full detail")).toBeTruthy();
  expect(ui.getByRole("button").props.accessibilityState.expanded).toBe(true);
});

test.each([false, true])(
  "consecutive note, memory and follow-up rows share density (screen reader: %s)",
  async (screenReader) => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(screenReader);
    const ui = await render(
      <ChatMessage
        agents={[]}
        respond={async () => {}}
        message={{
          id: "msg_notices",
          thread_id: "th_notices",
          seq: 1,
          author: { kind: "agent", id: "helper" },
          created_at: "2026-10-21T15:00:00Z",
          parts: [
            { type: "notice", code: "custom.note", text: "Note contents", detail: "Complete note", level: "info" },
            { type: "notice", code: "memory.saved", text: "Saved to memory", detail: "Complete memory", level: "info" },
            {
              type: "notice",
              code: "continuation.receipt",
              text: "Follow-up",
              level: "info",
              vars: { state: "pending", condition: "time", purpose: "Check the report", when: "2026-12-01T12:00:00Z" },
            },
          ],
        }}
      />,
    );
    const rows = ui.getAllByRole("button");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => StyleSheet.flatten(row.props.style).minHeight)).toEqual(
      screenReader ? [48, 48, 48] : [34, 34, 34],
    );
    expect(StyleSheet.flatten(ui.getByTestId("chat-message").props.style).marginVertical).toBe(1);
    for (const [index, detail] of ["Complete note", "Complete memory", "Check the report"].entries()) {
      const row = rows[index];
      if (!row) throw new Error("Missing disclosure row");
      expect(row.props.accessibilityState.expanded).toBe(false);
      await fireEvent.press(row);
      expect(ui.getByText(detail)).toBeTruthy();
      await fireEvent.press(row);
      expect(ui.queryByText(detail)).toBeNull();
    }
  },
);

test("the task page's plan remains expanded", async () => {
  const ui = await render(
    <PlanCard label={t("plan")} steps={[{ step: "Keep task steps visible", state: "pending" }]} />,
  );
  expect(ui.getByText("Keep task steps visible")).toBeTruthy();
  expect(ui.queryByRole("button")).toBeNull();
});
