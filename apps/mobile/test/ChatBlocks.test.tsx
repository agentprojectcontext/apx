import { render, within } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const turn = {
  id: "msg_1",
  thread_id: "th_1",
  seq: 1,
  author: { kind: "agent", id: "superagent" },
  created_at: "2026-10-21T15:00:00.000Z",
  delivery: "read",
  parts: [
    { type: "skills", engine: "local", loaded: [], hinted: ["deploy"], scored: [] },
    { type: "tool", call_id: "c2", tool: "make_image", title: "A cat", status: "running" },
    { type: "browser", tab: "tab_1", url: "https://example.com/docs", title: "Docs", state: "agent" },
    {
      type: "changes",
      cwd: "~/work/acme",
      edits: true,
      files: [{ path: "src/app.ts", status: "M", added: 3, removed: 1 }],
      more: 2,
    },
  ],
} as unknown as Message;

test("an agent's turn shows its skills, the picture forming, the page and the changes", async () => {
  const ui = await render(
    <ChatMessage
      message={turn}
      agents={[{ id: "superagent", name: "Roby" }]}
      runState="working"
      thread={{ kind: "agent", agent_ids: ["superagent"] }}
      respond={async () => {}}
    />,
  );
  expect(ui.getByText("deploy?")).toBeTruthy();
  expect(ui.getByLabelText(t("imageGenerating"))).toBeTruthy();
  expect(ui.getByText(t("browserAgentBrowsing", { name: "Roby", host: "example.com/docs" }))).toBeTruthy();
  expect(ui.getByText(t("changesEdited", { n: 3 }))).toBeTruthy();
  expect(ui.getByText(t("changesMore", { n: 2 }))).toBeTruthy();
  expect(ui.getByLabelText(t("deliveryRead"))).toBeTruthy();
});

test("computer use reads as one thing while the agent works on it", async () => {
  const message = {
    ...turn,
    parts: [{ type: "tool", call_id: "c1", tool: "screen_click", title: "Click", status: "running" }],
  } as unknown as Message;
  const ui = await render(<ChatMessage message={message} agents={[]} respond={async () => {}} />);
  expect(ui.getByText(t("toolsComputerWorking"))).toBeTruthy();
});

test("the agent's plan shows as a checklist at the end of its message, with how many steps are done", async () => {
  const message = {
    ...turn,
    parts: [
      {
        type: "plan",
        steps: [
          { step: "Check prices", state: "done" },
          { step: "Compare plans", state: "doing" },
          { step: "Write the summary", state: "pending" },
        ],
      },
      { type: "text", text: "Looking at prices" },
    ],
  } as unknown as Message;
  const ui = await render(<ChatMessage message={message} agents={[]} respond={async () => {}} />);
  expect(ui.getByLabelText(t("plan"))).toBeTruthy();
  expect(ui.getByText(t("planDone", { done: 1, count: 3 }))).toBeTruthy();
  expect(ui.getByText("Compare plans")).toBeTruthy();
  const tree = JSON.stringify(ui.toJSON());
  expect(tree.indexOf("Looking at prices")).toBeLessThan(tree.indexOf("Write the summary"));
});

test("a table the agent wrote shows as a grid that scrolls sideways, not as pipes", async () => {
  const message = {
    ...turn,
    parts: [
      {
        type: "text",
        text: "Here's a first cut of the **Q4 launch**:\n\n| Week | What | Who |\n|---|---|---|\n| 1 | Freeze the catalog | Tomás |\n| 2 | Landing page | Vera |",
      },
    ],
  } as unknown as Message;
  const ui = await render(<ChatMessage message={message} agents={[]} respond={async () => {}} />);
  const table = ui.getByTestId("markdown-table");
  expect(table.props.horizontal).toBe(true);
  // A sideways ScrollView grows by default and left a blank band under the table on Android.
  expect(table).toHaveStyle({ flexGrow: 0 });
  expect(within(table).getByText("Week")).toBeTruthy();
  expect(within(table).getByText("Freeze the catalog")).toBeTruthy();
  expect(within(table).getByText("Vera")).toBeTruthy();
  expect(ui.queryByText(/\|/)).toBeNull();
});
