import { act, fireEvent, render, within } from "@testing-library/react-native";
import { inboxTree } from "../src/hooks/inboxTree";
import { t } from "../src/i18n";
import { ChatsPage } from "../src/pages/ChatsPage";
import { InboxRow, ThreadAvatar } from "../src/pages/InboxRows";
import { inboxFixtures } from "../src/preview/inboxFixtures";
import { ALL_CHATS } from "../src/viewPrefs";
import { deferred } from "./transport.test-support";

// The contacts' pictures come through the media cache, which needs the phone's gallery module.
jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture or rendered row");
  return value;
}

const mount = async (patch: Partial<React.ComponentProps<typeof ChatsPage>> = {}) => {
  const props = {
    data: inboxFixtures(),
    online: false,
    open: jest.fn(),
    create: jest.fn(),
    account: jest.fn(),
    refresh: jest.fn(async () => {}),
    project: "all",
    setProject: jest.fn(),
    filter: ALL_CHATS,
    setFilter: jest.fn(),
    ...patch,
  };
  return { ...(await render(<ChatsPage {...props} />)), props };
};

test("a routine is one row that opens its latest run; same-name routines and legacy runs stay apart", async () => {
  const ui = await mount();
  const rows = ui.getAllByRole("button", { name: "Daily review" });
  expect(rows).toHaveLength(2);
  const first = required(rows[0]);
  // Its past runs are picked inside its chat: no fold in the list.
  expect(ui.queryByRole("button", { name: t("expandSessions", { name: "Daily review" }) })).toBeNull();
  expect(within(first).getByText("3")).toBeVisible();
  await fireEvent.press(first);
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "run_today" }));
  expect(ui.queryByText("Yesterday")).toBeNull();
  expect(ui.getByRole("button", { name: "Legacy routine" })).toBeVisible();
  await ui.unmount();
});

test("chat sessions expand recursively, keep independent open actions, unread totals and failed state", async () => {
  const ui = await mount();
  const root = ui.getByRole("button", { name: "Launch planning" });
  expect(within(root).getByText("5")).toBeVisible();
  expect(within(root).getByText(t("inboxFailed"))).toBeVisible();
  await fireEvent.press(root);
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "home" }));
  await fireEvent.press(ui.getByRole("button", { name: t("expandSessions", { name: "Launch planning" }) }));
  expect(ui.getByRole("button", { name: "Research sources" })).toBeVisible();
  expect(ui.queryByRole("button", { name: "Verify sources" })).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("expandSessions", { name: "Research sources" }) }));
  await fireEvent.press(ui.getByRole("button", { name: "Verify sources" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "session_b" }));
  expect(ui.queryByText("Archived session")).toBeNull();
  await ui.unmount();
});

test("a task is its latest chat's row; its other chats nest under it by who works them", async () => {
  const ui = await mount();
  const task = ui.getByRole("button", { name: "Prepare launch" });
  expect(within(task).getByText("2")).toBeVisible();
  await fireEvent.press(task);
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "task_chat_a" }));
  expect(ui.queryByRole("button", { name: "Reviewer" })).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("expandSessions", { name: "Prepare launch" }) }));
  await fireEvent.press(ui.getByRole("button", { name: "Reviewer" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "task_chat_b" }));
  await fireEvent.press(ui.getByRole("button", { name: "Compare options" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "task_delegate" }));
  await ui.unmount();
});

test("a long press on a task's row gives the task's options", async () => {
  const taskMenu = jest.fn();
  const ui = await mount({ taskMenu });
  await fireEvent(ui.getByRole("button", { name: "Prepare launch" }), "longPress");
  expect(taskMenu).toHaveBeenCalledWith("task_a");
  await ui.unmount();
});

test("search exposes matching nested sessions with ancestry, filters unrelated rows and clears cleanly", async () => {
  const ui = await mount();
  await fireEvent.press(ui.getByRole("button", { name: t("searchChats") }));
  await fireEvent.changeText(ui.getByPlaceholderText(t("searchChats")), "Verify sources");
  expect(ui.getByRole("button", { name: "Launch planning" })).toBeVisible();
  expect(ui.getByRole("button", { name: "Research sources" })).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: "Verify sources" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "session_b" }));
  expect(ui.queryByRole("button", { name: "Launch team" })).toBeNull();
  await fireEvent.changeText(ui.getByPlaceholderText(t("searchChats")), "No matching session");
  expect(ui.getByText(t("noChats"))).toBeVisible();
  await fireEvent.changeText(ui.getByPlaceholderText(t("searchChats")), "");
  expect(ui.getByRole("button", { name: "Launch team" })).toBeVisible();
  await ui.unmount();
});

test("project filtering promotes cross-project descendants and local callbacks preserve filter values", async () => {
  const ui = await mount({ project: "project_b" });
  expect(ui.getByRole("button", { name: "Northwind review" })).toBeVisible();
  expect(ui.queryByRole("button", { name: "Launch team" })).toBeNull();
  await fireEvent.press(ui.getByText("Acme"));
  expect(ui.props.setProject).toHaveBeenLastCalledWith("project_a");
  await fireEvent.press(ui.getByRole("button", { name: t("filterChats") }));
  await fireEvent.press(ui.getByRole("switch", { name: t("filterRoutines") }));
  expect(ui.props.setFilter).toHaveBeenLastCalledWith({ ...ALL_CHATS, routines: false });
  await fireEvent.press(ui.getByRole("button", { name: t("newChat") }));
  expect(ui.props.create).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("refresh indicator resets after rejection without changing or losing the list", async () => {
  const pending = deferred<void>();
  const ui = await mount({ refresh: () => pending.promise });
  const control = ui.getByTestId("chats-list").props.refreshControl;
  await act(async () => {
    control.props.onRefresh();
  });
  expect(ui.getByTestId("chats-list").props.refreshControl.props.refreshing).toBe(true);
  await act(async () => {
    pending.reject(new Error("Offline"));
    await pending.promise.catch(() => undefined);
  });
  expect(ui.getByTestId("chats-list").props.refreshControl.props.refreshing).toBe(false);
  expect(ui.getByRole("button", { name: "Launch planning" })).toBeVisible();
  await ui.unmount();
});

test("a group pair takes a little more than one face; a delegation pair shows the target then the caller", async () => {
  const data = inboxFixtures();
  const home = required(data.threads.find((thread) => thread.id === "home"));
  const ui = await render(<ThreadAvatar thread={home} agents={data.agents} size={34} />);
  expect(ui.getByLabelText("Coordinator")).toHaveStyle({ width: 34, height: 34 });
  await ui.rerender(
    <ThreadAvatar
      thread={required(data.threads.find((thread) => thread.id === "group"))}
      agents={data.agents}
      size={34}
    />,
  );
  expect(ui.getByLabelText(t("groupAgents", { first: "Coordinator", second: "Researcher" }))).toHaveStyle({
    width: 38,
    height: 38,
  });
  await ui.rerender(
    <ThreadAvatar
      thread={required(data.threads.find((thread) => thread.id === "session_a"))}
      agents={data.agents}
      size={34}
      caller="agent_a"
    />,
  );
  expect(ui.getByLabelText(t("delegationPair", { target: "Researcher", caller: "Coordinator" }))).toHaveStyle({
    width: 34,
    height: 34,
  });
  await ui.unmount();
  const row = await render(
    <InboxRow node={required(inboxTree([home], { routines: true, project: "all" })[0])} data={data} open={jest.fn()} />,
  );
  expect(row.getByRole("button", { name: "Launch planning" })).toHaveStyle({ paddingVertical: 9 });
  await row.unmount();
});

test("a long press opens a chat's actions, archived chats have their own row and a filter shows its dot", async () => {
  const menu = jest.fn();
  const openArchived = jest.fn();
  const ui = await mount({ menu, openArchived });
  await fireEvent(ui.getByRole("button", { name: "Launch planning" }), "longPress");
  expect(menu).toHaveBeenLastCalledWith(expect.objectContaining({ id: "home" }));
  await fireEvent.press(ui.getByRole("button", { name: `${t("archivedChats")} 1` }));
  expect(openArchived).toHaveBeenCalledTimes(1);
  expect(ui.queryByRole("button", { name: t("filterChatsOn") })).toBeNull();
  await ui.rerender(
    <ChatsPage {...ui.props} menu={menu} openArchived={openArchived} filter={{ ...ALL_CHATS, agents: ["agent_b"] }} />,
  );
  expect(ui.getByRole("button", { name: t("filterChatsOn") })).toBeVisible();
  expect(ui.queryByRole("button", { name: "Launch planning" })).toBeNull();
  expect(ui.getByRole("button", { name: "Research sources" })).toBeVisible();
  await ui.unmount();
});
