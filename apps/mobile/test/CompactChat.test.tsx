import { fireEvent, render } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { NoticeCard } from "../src/ui/chat/NoticeCard";
import { PlanCard } from "../src/ui/chat/PlanCard";

test("context notes start folded and reveal their entire text and detail", async () => {
  const text = "Earlier turns were summarized without starting a new conversation.";
  const detail = "Complete context detail\n".repeat(12);
  const ui = await render(
    <NoticeCard part={{ type: "notice", code: "thread.compacted", level: "info", text, detail }} />,
  );
  expect(ui.queryByText(detail)).toBeNull();
  const row = ui.getByRole("button");
  expect(row.props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(row);
  expect(ui.getByText(detail)).toBeTruthy();
  expect(ui.getByRole("button").props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText(detail)).toBeNull();
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
    <PlanCard label={t("plan")} steps={steps.map((s, i) => (i === 0 ? { ...s, state: "done" } : s))} collapsible />,
  );
  expect(ui.getByText(t("planDone", { done: 1, count: 3 }))).toBeTruthy();
  expect(ui.getByText("Read the brief")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button"));
  expect(ui.queryByText("Read the brief")).toBeNull();
  await ui.rerender(<PlanCard label={t("plan")} steps={steps.map((s) => ({ ...s, state: "done" }))} collapsible />);
  expect(ui.getByText(t("planDone", { done: 3, count: 3 }))).toBeTruthy();
});

test("the task page's plan remains expanded", async () => {
  const ui = await render(
    <PlanCard label={t("plan")} steps={[{ step: "Keep task steps visible", state: "pending" }]} />,
  );
  expect(ui.getByText("Keep task steps visible")).toBeTruthy();
  expect(ui.queryByRole("button")).toBeNull();
});
