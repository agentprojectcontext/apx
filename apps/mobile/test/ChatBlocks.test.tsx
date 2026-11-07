import { fireEvent, render, within } from "@testing-library/react-native";
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

test("while the agent works its plan shows as a checklist at the end of its message, with steps done", async () => {
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
  const ui = await render(<ChatMessage message={message} agents={[]} runState="working" respond={async () => {}} />);
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

test("the owner's words waiting for the agent can be sent now, taken back, edited and moved", async () => {
  const actions = {
    sendNow: jest.fn(async () => {}),
    unsend: jest.fn(async () => {}),
    editQueued: jest.fn(async () => true),
    moveQueued: jest.fn(async () => {}),
  };
  const mine = (id: string, waiting: Message["waiting"]) =>
    ({
      ...turn,
      id,
      author: { kind: "user" },
      parts: [{ type: "text", text: `words ${id}` }],
      waiting,
    }) as unknown as Message;
  const steer = mine("steer", { until: "step" });
  const step = await render(<ChatMessage message={steer} agents={[]} respond={async () => {}} queue={{ actions }} />);
  await fireEvent.press(step.getByRole("button", { name: t("waitingSendNow") }));
  expect(actions.sendNow).toHaveBeenCalledWith(steer);
  expect(step.queryByRole("button", { name: t("waitingEdit") })).toBeNull();
  await fireEvent.press(step.getByRole("button", { name: t("waitingRemove") }));
  expect(actions.unsend).toHaveBeenCalledWith(steer);
  await step.unmount();

  const line = [mine("a", { until: "turn", run: "run_a" }), mine("b", { until: "turn", run: "run_b" })];
  const second = await render(
    <ChatMessage message={line[1] as Message} agents={[]} respond={async () => {}} queue={{ actions, line }} />,
  );
  expect(second.queryByRole("button", { name: t("waitingDown") })).toBeNull();
  await fireEvent.press(second.getByRole("button", { name: t("waitingUp") }));
  expect(actions.moveQueued).toHaveBeenCalledWith(line, line[1], -1);
  await fireEvent.press(second.getByRole("button", { name: t("waitingEdit") }));
  await fireEvent.changeText(second.getByDisplayValue("words b"), "new words");
  await fireEvent.press(second.getByRole("button", { name: t("save") }));
  expect(actions.editQueued).toHaveBeenCalledWith(line[1], "new words");
  await second.unmount();
});

test("a message the agent took after it waited reads as taken", async () => {
  const waiting = {
    ...turn,
    id: "w1",
    author: { kind: "user" },
    parts: [{ type: "text", text: "hey" }],
  } as unknown as Message;
  const ui = await render(
    <ChatMessage message={{ ...waiting, waiting: { until: "step" } }} agents={[]} respond={async () => {}} />,
  );
  expect(ui.queryByText(t("waitingTaken"))).toBeNull();
  await ui.rerender(<ChatMessage message={waiting} agents={[]} respond={async () => {}} />);
  expect(ui.getByText(t("waitingTaken"))).toBeTruthy();
});

test("a message that came in on another app, or in Chrome, says so; in that app's own chat it does not", async () => {
  const channels = [{ id: "tg_1", type: "telegram", label: "Telegram" }];
  const said = (via: string) =>
    ({
      ...turn,
      id: `m_${via}`,
      author: { kind: "user" },
      parts: [{ type: "text", text: "hi" }],
      via,
    }) as unknown as Message;
  const home = { kind: "loose", agent_ids: ["superagent"] };
  const ui = await render(
    <ChatMessage message={said("tg_1")} agents={[]} thread={home} channels={channels} respond={async () => {}} />,
  );
  expect(ui.getByLabelText(t("viaReceived", { channel: "Telegram" }))).toBeTruthy();
  await ui.rerender(
    <ChatMessage message={said("chrome")} agents={[]} thread={home} channels={channels} respond={async () => {}} />,
  );
  expect(ui.getByLabelText(t("viaReceived", { channel: "Chrome" }))).toBeTruthy();
  await ui.rerender(
    <ChatMessage
      message={said("tg_1")}
      agents={[]}
      thread={{ ...home, channel: { id: "tg_1" } }}
      channels={channels}
      respond={async () => {}}
    />,
  );
  expect(ui.queryByLabelText(t("viaReceived", { channel: "Telegram" }))).toBeNull();
});

test("a page the agent uses in the owner's Chrome says so, not that it browses in APX", async () => {
  const message = {
    ...turn,
    parts: [
      { type: "browser", tab: "t1", url: "https://example.com/a", title: "A", state: "agent", environment: "chrome" },
    ],
  } as unknown as Message;
  const ui = await render(
    <ChatMessage message={message} agents={[{ id: "superagent", name: "Roby" }]} respond={async () => {}} />,
  );
  expect(ui.getByText(t("browserInChrome", { name: "Roby" }))).toBeTruthy();
});

test("a teammate's answer held for the others asked in the same turn says how many came in", async () => {
  const message = {
    ...turn,
    parts: [
      {
        type: "subthread",
        thread_id: "th_2",
        agent_id: "superagent",
        title: "Check prices",
        status: "completed",
        held: { got: 1, of: 3 },
      },
    ],
  } as unknown as Message;
  const ui = await render(<ChatMessage message={message} agents={[]} respond={async () => {}} />);
  expect(ui.getByText(t("subthreadHeld", { got: 1, of: 3 }))).toBeTruthy();
});

test("a reply a fallback model gave says so next to the model", async () => {
  const message = {
    ...turn,
    model: "gemini/flash",
    parts: [
      { type: "text", text: "Done." },
      { type: "notice", code: "engine.fallback", level: "info", text: "x", vars: { model: "a", why: "b", to: "c" } },
    ],
  } as unknown as Message;
  const ui = await render(
    <ChatMessage message={message} agents={[{ id: "superagent", name: "Roby" }]} respond={async () => {}} />,
  );
  expect(ui.getByText(new RegExp(t("modelFallback")))).toBeTruthy();
});
