import { act, fireEvent, render, within } from "@testing-library/react-native";
import { inboxTree } from "../src/hooks/inboxTree";
import { t } from "../src/i18n";
import { ChatsPage } from "../src/pages/ChatsPage";
import { InboxRow, ThreadAvatar } from "../src/pages/InboxRows";
import { inboxFixtures } from "../src/preview/inboxFixtures";
import { deferred } from "./transport.test-support";

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
    routines: true,
    setRoutines: jest.fn(),
    ...patch,
  };
  return { ...(await render(<ChatsPage {...props} />)), props };
};

test("routine headers collapse cross-day executions, distinguish same-name identities and open exact runs", async () => {
  const ui = await mount();
  expect(ui.getAllByRole("button", { name: "Daily review" })).toHaveLength(2);
  expect(ui.queryByText("Latest summary.")).toBeNull();
  const first = required(ui.getAllByRole("button", { name: "Daily review" })[0]);
  expect(first.props.accessibilityState).toMatchObject({ expanded: false });
  await fireEvent.press(first);
  expect(required(ui.getAllByRole("button", { name: "Daily review" })[0]).props.accessibilityState).toMatchObject({
    expanded: true,
  });
  expect(ui.getByText(t("routineRuns", { n: 3 }))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: "Latest summary." }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "run_today" }));
  await fireEvent.press(ui.getByRole("button", { name: t("expandSessions", { name: "Latest summary." }) }));
  await fireEvent.press(ui.getByRole("button", { name: "Check metrics" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "run_delegate" }));
  await fireEvent.press(first);
  expect(ui.queryByRole("button", { name: "Check metrics" })).toBeNull();
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

test("tasks group multiple agents and keep delegated sessions below the correct task chat", async () => {
  const ui = await mount();
  await fireEvent.press(ui.getByRole("button", { name: "Prepare launch" }));
  expect(ui.getByRole("button", { name: "Draft proposal" })).toBeVisible();
  expect(ui.getByRole("button", { name: "Review proposal" })).toBeVisible();
  expect(ui.queryByRole("button", { name: "Compare options" })).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("expandSessions", { name: "Draft proposal" }) }));
  await fireEvent.press(ui.getByRole("button", { name: "Compare options" }));
  expect(ui.props.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "task_delegate" }));
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
  await fireEvent.press(ui.getByRole("button", { name: t("hideRoutines") }));
  expect(ui.props.setRoutines).toHaveBeenLastCalledWith(false);
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

test("single faces shrink to 38; group pairs retain 48 and delegation pairs include target then caller", async () => {
  const data = inboxFixtures();
  const home = required(data.threads.find((thread) => thread.id === "home"));
  const ui = await render(<ThreadAvatar thread={home} agents={data.agents} size={38} />);
  expect(ui.getByLabelText("Coordinator")).toHaveStyle({ width: 38, height: 38 });
  await ui.rerender(
    <ThreadAvatar
      thread={required(data.threads.find((thread) => thread.id === "group"))}
      agents={data.agents}
      size={38}
    />,
  );
  expect(ui.getByLabelText(t("groupAgents", { first: "Coordinator", second: "Researcher" }))).toHaveStyle({
    width: 48,
    height: 48,
  });
  await ui.rerender(
    <ThreadAvatar
      thread={required(data.threads.find((thread) => thread.id === "session_a"))}
      agents={data.agents}
      size={38}
      caller="agent_a"
    />,
  );
  expect(ui.getByLabelText(t("delegationPair", { target: "Researcher", caller: "Coordinator" }))).toHaveStyle({
    width: 38,
    height: 38,
  });
  await ui.unmount();
  const row = await render(
    <InboxRow node={required(inboxTree([home], { routines: true, project: "all" })[0])} data={data} open={jest.fn()} />,
  );
  expect(row.getByRole("button", { name: "Launch planning" })).toHaveStyle({ paddingVertical: 8 });
  await row.unmount();
});
