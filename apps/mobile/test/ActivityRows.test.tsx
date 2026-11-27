import { fireEvent, render } from "@testing-library/react-native";
import { mediaRows } from "../src/chat/media";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { InputCard } from "../src/ui/chat/InputCard";
import { NoticeCard } from "../src/ui/chat/NoticeCard";

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
