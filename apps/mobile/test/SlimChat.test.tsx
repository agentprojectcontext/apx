import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { InboxItem } from "../src/hooks/inboxItems";
import { emptyWorkspace, type Task, type Thread } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { InboxPage } from "../src/pages/InboxPage";
import { rowState } from "../src/pages/InboxRows";
import type { Message, RoutineRun } from "../src/protocol";
import { QueueTray } from "../src/ui/chat/QueueTray";
import { RoutineRunsSheet } from "../src/ui/chat/RoutineRunsSheet";

// Agents' faces and contacts' pictures come through the media cache, which needs the phone's gallery module.
jest.mock("../src/chat/mediaFiles", () => ({}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (children: React.ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>);

const queued = (id: string, seq: number): Message => ({
  id,
  thread_id: "th",
  seq,
  author: { kind: "user" },
  parts: [{ type: "text", text: `Words of ${id}` }],
  created_at: "2026-11-09T10:00:00Z",
  waiting: { until: "turn", run: `run_${id}` },
});
const waitingActions = () => ({
  sendNow: jest.fn(async () => {}),
  unsend: jest.fn(async () => {}),
  editQueued: jest.fn(async () => true),
  moveQueued: jest.fn(async () => {}),
});

test("the queue tray lists what waits in order, sends one now in a tap and gives the rest from its sheet", async () => {
  const actions = waitingActions();
  const line = [queued("first", 1), queued("second", 2)];
  const ui = await mount(<QueueTray line={line} name="Lucía" actions={actions} />);
  expect(ui.getByText(t("waitingLineFor", { name: "Lucía" }))).toBeVisible();
  expect(ui.getByText("2")).toBeVisible();
  await fireEvent.press(ui.getAllByRole("button", { name: t("waitingSendNow") })[1] as never);
  expect(actions.sendNow).toHaveBeenCalledWith(line[1]);
  await fireEvent.press(ui.getByText("Words of second"));
  expect(ui.getByText(t("waitingUp"))).toBeVisible();
  expect(ui.queryByText(t("waitingDown"))).toBeNull();
  await fireEvent.press(ui.getByText(t("waitingUp")));
  await waitFor(() => expect(actions.moveQueued).toHaveBeenCalledWith(line, line[1], -1));
  await fireEvent.press(ui.getByRole("button", { name: t("waitingHide") }));
  expect(ui.queryByText("Words of first")).toBeNull();
  await ui.unmount();
});

test("an empty line shows no tray", async () => {
  const ui = await mount(<QueueTray line={[]} name="Lucía" actions={waitingActions()} />);
  expect(ui.queryByText(t("waitingQueue"))).toBeNull();
  await ui.unmount();
});

const run = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: `Daily · ${id}`,
  kind: "routine",
  routine_id: "r_daily",
  agent_ids: ["agent_a"],
  state: "completed",
  preview: `Told in ${id}`,
  unread: 0,
  updated_at: "2026-11-08T09:00:00Z",
  ...patch,
});

test("a routine's run picker lists its runs, marks the one on screen and switches to another", async () => {
  const today = run("today", { updated_at: "2026-11-09T09:00:00Z" });
  const older: RoutineRun = {
    run_id: "run_old",
    thread_id: "older",
    state: "failed",
    started_at: "2026-11-01T09:00:00Z",
  };
  const loadRuns = jest.fn(async () => [older]);
  const onPick = jest.fn();
  const onRoutine = jest.fn();
  const ui = await mount(
    <RoutineRunsSheet
      thread={today}
      threads={[today, run("yesterday")]}
      name="Daily"
      loadRuns={loadRuns}
      onPick={onPick}
      onRoutine={onRoutine}
      onClose={jest.fn()}
    />,
  );
  await waitFor(() => expect(ui.getByText(t("rtPastRuns", { n: 3 }))).toBeVisible());
  expect(loadRuns).toHaveBeenCalledWith("r_daily", 60);
  expect(ui.getByText(t("inboxFailed"))).toBeVisible();
  await fireEvent.press(ui.getByText("Told in yesterday"));
  await waitFor(() => expect(onPick).toHaveBeenCalledWith("yesterday"));
  await ui.unmount();
});

test("a task or routine row says where it stands; a run in progress reads as running", () => {
  expect(rowState("routine", { busy: false, waiting: false, failed: false }).label).toBe("stateDone");
  expect(rowState("routine", { busy: true, waiting: false, failed: true }).label).toBe("stateRunning");
  expect(rowState("routine", { busy: false, waiting: false, failed: true }).label).toBe("inboxFailed");
  const task = { state: "open", status: "todo", awaits_owner: false } as unknown as Task;
  expect(rowState("task", { task, busy: false, waiting: false, failed: false }).label).toBe("statePending");
  expect(rowState("task", { task, busy: false, waiting: true, failed: false }).label).toBe("waitsForYou");
  expect(
    rowState("task", { task: { ...task, state: "dropped" }, busy: true, waiting: false, failed: false }).label,
  ).toBe("stateDropped");
});

test("a notice with no chat to open shows one button to clear it", async () => {
  const item: InboxItem = {
    id: "n1",
    label: "inboxMessage",
    tone: "brand",
    context: "",
    at: "2026-11-09T10:00:00Z",
    title: "Someone wants to talk",
    primary: { label: "done", action: { kind: "dismiss" } },
    secondary: { label: "done", action: { kind: "dismiss" } },
  };
  const ui = await mount(
    <InboxPage
      data={emptyWorkspace}
      items={[item]}
      open={jest.fn()}
      read={jest.fn(async () => {})}
      respond={jest.fn(async () => {})}
      rerun={jest.fn(async () => {})}
      muteEvent={jest.fn(async () => {})}
      continueSession={jest.fn(async () => {})}
    />,
  );
  expect(ui.getAllByRole("button", { name: t("done") })).toHaveLength(1);
  await ui.unmount();
});
