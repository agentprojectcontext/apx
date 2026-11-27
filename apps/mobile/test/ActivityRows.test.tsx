import { fireEvent, render } from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, StyleSheet, Text } from "react-native";
import { mediaRows } from "../src/chat/media";
import { t, translator } from "../src/i18n";
import type { Message } from "../src/protocol";
import { ActionGroup } from "../src/ui/ActionGroup";
import { AgentEventCard } from "../src/ui/chat/AgentEventCard";
import { CompactRow } from "../src/ui/chat/CompactRow";
import { DetailBranch } from "../src/ui/chat/DetailBranch";
import { InputCard } from "../src/ui/chat/InputCard";
import { NoticeCard } from "../src/ui/chat/NoticeCard";

test("action groups and nested details share the disclosure header and keep independent states", async () => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  Dimensions.set({ window: { width: 390, height: 844, scale: 1, fontScale: 1 } });
  const reference = await render(
    <CompactRow compact title="Reference" icon="FileText">
      <Text>Reference detail</Text>
    </CompactRow>,
  );
  const headingStyle = StyleSheet.flatten(reference.getByRole("button").props.style);
  const ui = await render(
    <ActionGroup
      parts={[
        {
          type: "tool",
          tool: "file_read",
          call_id: "read",
          title: "Read the report",
          status: "ok",
          detail: "Report contents",
        },
        {
          type: "tool",
          tool: "shell",
          call_id: "check",
          title: "Check the report",
          status: "error",
          detail: "Missing reference",
        },
      ]}
    />,
  );
  const header = ui.getByRole("button");
  expect(StyleSheet.flatten(header.props.style)).toEqual(headingStyle);
  expect(header.props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(header);
  const first = ui.getByRole("button", { name: `Read the report, ${t("runDone")}` });
  const second = ui.getByRole("button", { name: `Check the report, ${t("runFailed")}` });
  expect(StyleSheet.flatten(first.props.style)).toEqual({ ...headingStyle, minHeight: 32 });
  await fireEvent.press(first);
  expect(ui.getByText("Report contents")).toBeTruthy();
  await fireEvent.press(second);
  expect(ui.queryByText("Report contents")).toBeNull();
  expect(ui.getByText("Missing reference")).toBeTruthy();
  expect(ui.getByTestId("detail-guide", { includeHiddenElements: true }).props.style).toMatchObject({
    borderBottomLeftRadius: 8,
  });
});

test("agent events share the header, retain source navigation and show the straight line only while open", async () => {
  const reference = await render(
    <CompactRow compact title="Reference" icon="Bot">
      <Text>Reference detail</Text>
    </CompactRow>,
  );
  const openThread = jest.fn();
  const ui = await render(
    <AgentEventCard
      name="Acme"
      openThread={openThread}
      message={{
        id: "msg_event",
        thread_id: "th_main",
        seq: 1,
        created_at: "2026-10-21T15:00:00Z",
        author: { kind: "agent", id: "agent_helper" },
        parts: [
          {
            type: "text",
            text: "Finished",
            response: {
              thread_id: "th_source",
              run_id: "run_source",
              task_id: "task_source",
              title: "Review",
              state: "completed",
            },
          },
        ],
      }}
    >
      <Text>Full event report</Text>
    </AgentEventCard>,
  );
  const header = ui.getByRole("button");
  expect(StyleSheet.flatten(header.props.style)).toEqual(StyleSheet.flatten(reference.getByRole("button").props.style));
  expect(header.props.accessibilityState.expanded).toBe(true);
  expect(ui.getByTestId("detail-guide", { includeHiddenElements: true }).props.style).toMatchObject({
    top: 0,
    bottom: 0,
  });
  await fireEvent.press(ui.getByRole("link"));
  expect(openThread).toHaveBeenCalledWith("th_source");
  await fireEvent.press(header);
  expect(ui.queryByText("Full event report")).toBeNull();
  expect(ui.queryByTestId("detail-guide", { includeHiddenElements: true })).toBeNull();
  await fireEvent.press(header);
  expect(ui.getByText("Full event report")).toBeTruthy();
});

test("only an exact echo of a settled question folds into its question row", () => {
  const question: Extract<Message["parts"][number], { type: "input" }> = {
    type: "input",
    input_id: "q",
    kind: "question",
    state: "answered",
    prompt: "Which option?",
    answer: "Second",
  };
  const echoed: Message["parts"][number] = { type: "text", text: "Which option?" };
  const other: Message["parts"][number] = { type: "text", text: "The report is ready." };
  expect(mediaRows([echoed, question, other]).map((row) => (row.kind === "part" ? row.part : null))).toEqual([
    question,
    other,
  ]);
  expect(mediaRows([echoed, { ...question, state: "pending" }, other])).toHaveLength(3);
  expect(mediaRows([{ type: "text", text: "Which option? More context." }, question, other])).toHaveLength(3);
});

test("agent reports use a full-height side line while other disclosures keep the curved connector", async () => {
  const ui = await render(
    <DetailBranch straight>
      <Text>Full report</Text>
    </DetailBranch>,
  );
  const guide = () => ui.getByTestId("detail-guide", { includeHiddenElements: true });
  expect(guide().props.style).toMatchObject({ top: 0, bottom: 0, borderLeftWidth: 1 });
  expect(guide().props.style.borderBottomWidth).toBeUndefined();
  expect(guide().props.accessible).toBe(false);
  expect(ui.getByText("Full report")).toBeTruthy();
  await ui.rerender(
    <DetailBranch>
      <Text>Other detail</Text>
    </DetailBranch>,
  );
  expect(guide().props.style).toMatchObject({ borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 8 });
});

jest.mock("../src/ui/Icon", () => {
  const { View } = jest.requireActual("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

test.each(["Canceled.", "APX restarted."])("brief notice %s reads directly without a disclosure", async (text) => {
  const ui = await render(<NoticeCard part={{ type: "notice", code: "test.short", level: "info", text }} />);
  expect(ui.getByText(text)).toBeTruthy();
  expect(ui.queryByText(t("noticeInfo"))).toBeNull();
  expect(ui.queryByRole("button")).toBeNull();
});

test("long notes and notices with supporting detail still fold", async () => {
  const text = "A detailed explanation of the interruption and how to recover. ".repeat(8);
  const ui = await render(<NoticeCard part={{ type: "notice", code: "test.long", level: "info", text }} />);
  expect(ui.queryByText(text)).toBeNull();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getByText(text)).toBeTruthy();
  await ui.rerender(
    <NoticeCard
      part={{ type: "notice", code: "test.short", level: "info", text: "Short", detail: "Supporting explanation" }}
    />,
  );
  expect(ui.getByText("Supporting explanation")).toBeTruthy();
});

test.each(["question", "confirm"] as const)(
  "expired %s retains readable history but no response controls",
  async (kind) => {
    const respond = jest.fn();
    const ui = await render(
      <InputCard
        part={{
          type: "input",
          input_id: "expired",
          kind,
          state: "expired",
          prompt: "Old request",
          options: ["Yes", "No"],
        }}
        respond={respond}
      />,
    );
    expect(ui.getByText(t("inputExpired"), { exact: false })).toBeTruthy();
    await fireEvent.press(ui.getByRole("button"));
    expect(ui.getByText("Old request")).toBeTruthy();
    expect(ui.queryByText("Yes")).toBeNull();
    expect(ui.queryByRole("textbox")).toBeNull();
    expect(ui.getAllByRole("button")).toHaveLength(1);
    expect(respond).not.toHaveBeenCalled();
  },
);

test("the unavailable response message is localized for questions and confirmations", () => {
  expect(translator("en")("inputUnavailable")).toBe("This request is no longer available.");
  expect(translator("es")("inputUnavailable")).toBe("Esta solicitud ya no está disponible.");
});

test("answered questions fold question and answer together under an independent row", async () => {
  const ui = await render(
    <InputCard
      part={{
        type: "input",
        input_id: "answered",
        kind: "question",
        state: "answered",
        prompt: "Which option?",
        answer: "The second option",
      }}
      respond={jest.fn()}
    />,
  );
  expect(ui.getByText(t("inputAskedQuestion"), { exact: false })).toBeTruthy();
  expect(ui.queryByText("Which option?")).toBeNull();
  expect(ui.queryByText("“The second option”")).toBeNull();
  expect(ui.getByTestId("icon-ChevronRight")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.getByText("Which option?")).toBeTruthy();
  expect(ui.getByText("“The second option”")).toBeTruthy();
  expect(ui.getByRole("button").props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText("Which option?")).toBeNull();
});
