import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { inboxItems } from "../src/hooks/inboxItems";
import { emptyWorkspace, type PendingInput } from "../src/hooks/useWorkspace";
import * as i18n from "../src/i18n";
import { InboxPage } from "../src/pages/InboxPage";
import type { Message } from "../src/protocol";
import { InputCard } from "../src/ui/chat/InputCard";

jest.mock("../src/chat/mediaFiles", () => ({}));

const input: PendingInput = {
  id: "input_copy",
  run_id: "run_copy",
  thread_id: "thread_copy",
  agent_id: "agent_copy",
  kind: "confirm",
  state: "pending",
  prompt: "Publish this copy?",
  tool: "apx_settings",
  artifact_draft: "00000000-0000-4000-8000-000000000001",
  approval_scopes: ["once", "session", "always"],
};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mountInbox = (pending: PendingInput, respond = jest.fn(async () => {})) => {
  const data = { ...emptyWorkspace, inputs: [pending] };
  const open = jest.fn();
  return {
    open,
    respond,
    ui: render(
      <SafeAreaProvider initialMetrics={metrics}>
        <InboxPage
          data={data}
          items={inboxItems(data)}
          open={open}
          read={jest.fn(async () => {})}
          respond={respond}
          rerun={jest.fn(async () => {})}
          continueSession={jest.fn(async () => {})}
          muteEvent={jest.fn(async () => {})}
        />
      </SafeAreaProvider>,
    ),
  };
};

beforeEach(() => {
  jest.spyOn(i18n, "t").mockImplementation(i18n.translator("en"));
});

test.each(["en", "es"] as const)(
  "%s input card requires computer review and still allows rejection",
  async (language) => {
    jest.mocked(i18n.t).mockImplementation(i18n.translator(language));
    const part: Extract<Message["parts"][number], { type: "input" }> = {
      ...input,
      type: "input",
      input_id: input.id,
      state: "pending",
    };
    const respond = jest.fn(async () => {});
    const ui = await render(<InputCard part={part} respond={respond} />);
    expect(ui.getByText(i18n.t("artifactReviewOnComputer"))).toBeVisible();
    expect(ui.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([i18n.t("deny")]);
    expect(respond).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByRole("button", { name: i18n.t("deny") }));
    await waitFor(() => expect(respond).toHaveBeenCalledWith(input.id, { decision: "deny" }));
    expect(respond).toHaveBeenCalledTimes(1);
  },
);

test.each(["en", "es"] as const)("%s inbox opens the chat without approving the public copy", async (language) => {
  jest.mocked(i18n.t).mockImplementation(i18n.translator(language));
  const mounted = mountInbox(input);
  const ui = await mounted.ui;
  expect(ui.getByText(i18n.t("artifactReviewOnComputer"))).toBeVisible();
  expect(ui.getAllByRole("button")).toHaveLength(1);
  await fireEvent.press(ui.getByRole("button", { name: i18n.t("view") }));
  await waitFor(() => expect(mounted.open).toHaveBeenCalledWith(input.thread_id));
  expect(mounted.respond).not.toHaveBeenCalled();
});

test.each([
  { ...input, tool: undefined },
  { ...input, tool: "apx_settings" },
])("input card blocks approval for draft metadata with or without a tool name (%j)", async (pending) => {
  const ui = await render(
    <InputCard part={{ ...pending, type: "input", input_id: pending.id, state: "pending" }} respond={jest.fn()} />,
  );
  expect(ui.getByText(i18n.t("artifactReviewOnComputer"))).toBeVisible();
  expect(ui.getAllByRole("button")).toHaveLength(1);
  expect(ui.getByRole("button", { name: i18n.t("deny") })).toBeVisible();
});

test("a confirmation without a public draft keeps its normal inbox approval", async () => {
  const mounted = mountInbox({ ...input, artifact_draft: undefined, tool: "shell", approval_scopes: undefined });
  const ui = await mounted.ui;
  expect(ui.queryByText(i18n.t("artifactReviewOnComputer"))).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: i18n.t("approve") }));
  await waitFor(() => expect(mounted.respond).toHaveBeenCalledWith(input.id, { decision: "approve" }));
});
