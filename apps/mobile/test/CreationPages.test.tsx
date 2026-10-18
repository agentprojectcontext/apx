import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace, type Project, type Task } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { NewProjectPage } from "../src/pages/NewProjectPage";
import { NewTaskPage } from "../src/pages/NewTaskPage";
import { deferred } from "./transport.test-support";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (children: React.ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>);
const task: Task = {
  id: "tsk_new",
  title: "Review",
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  awaits_owner: false,
  thread_id: "thr_new",
  activity_at: "2026-10-18T10:00:00Z",
};
const project: Project = { id: "p_new", name: "Acme", path: "/work/acme", registered: true };

test("new projects require a nonblank name, trim input and omit unset optional fields", async () => {
  const create = jest.fn(async () => project);
  const created = jest.fn();
  const back = jest.fn();
  const ui = await mount(<NewProjectPage host="Acme" create={create} created={created} back={back} />);
  expect(ui.getByRole("button", { name: t("tkCreate") })).toBeDisabled();
  await fireEvent.changeText(ui.getByLabelText(t("pjName")), "   ");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).not.toHaveBeenCalled();
  await fireEvent.changeText(ui.getByLabelText(t("pjName")), "  Acme  ");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledWith({ name: "Acme" });
  expect(created).toHaveBeenCalledWith(project);
  await ui.unmount();
});

test("project kind and description reach creation, with duplicate taps blocked until completion", async () => {
  const pending = deferred<Project>();
  const create = jest.fn(() => pending.promise);
  const created = jest.fn();
  const ui = await mount(<NewProjectPage host="Acme" create={create} created={created} back={jest.fn()} />);
  await fireEvent.changeText(ui.getByLabelText(t("pjName")), "Acme");
  await fireEvent.changeText(ui.getByLabelText(t("tkDescription")), "  Build a panel  ");
  await fireEvent.press(ui.getByText(t("pjKind")));
  await fireEvent.press(ui.getByText(t("pjKindSoftware")));
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledWith({ name: "Acme", kind: "software", description: "Build a panel" });
  expect(ui.getByRole("button", { name: t("tkCreate") })).toBeDisabled();
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
  await act(async () => pending.resolve(project));
  expect(created).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("project failure preserves entered fields, reports the error and enables retry", async () => {
  const create = jest
    .fn<Promise<Project>, []>()
    .mockRejectedValueOnce(new Error("Folder refused"))
    .mockResolvedValue(project);
  const alert = jest.spyOn(Alert, "alert");
  const created = jest.fn();
  const back = jest.fn();
  const ui = await mount(<NewProjectPage host="Acme" create={create} created={created} back={back} />);
  await fireEvent.changeText(ui.getByLabelText(t("pjName")), "Acme");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(alert).toHaveBeenCalledWith(t("pjNew"), "Folder refused");
  expect(ui.getByLabelText(t("pjName"))).toHaveDisplayValue("Acme");
  expect(created).not.toHaveBeenCalled();
  expect(ui.getByRole("button", { name: t("tkCreate") })).toBeEnabled();
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(created).toHaveBeenCalledWith(project);
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  expect(back).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("task creation trims text, chooses the first board column and returns the created task", async () => {
  const create = jest.fn(async () => task);
  const created = jest.fn();
  const data = { ...emptyWorkspace, columns: [{ id: "ready", label: "Ready", tone: "neutral" as const }] };
  const ui = await mount(<NewTaskPage data={data} create={create} created={created} back={jest.fn()} />);
  expect(ui.getByRole("button", { name: t("tkCreate") })).toBeDisabled();
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "  Review  ");
  await fireEvent.changeText(ui.getByLabelText(t("tkDescription")), "  Read changes  ");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledWith({
    title: "Review",
    description: "Read changes",
    status: "ready",
    kind: "task",
    priority: "normal",
    project: undefined,
    assignee: undefined,
    due_at: undefined,
  });
  expect(created).toHaveBeenCalledWith(task);
  await ui.unmount();
});

test("task fields use selected priority, project and assignee in the creation request", async () => {
  const create = jest.fn(async () => task);
  const data = {
    ...emptyWorkspace,
    projects: [project],
    agents: [{ id: "april", name: "April", project_id: project.id }],
  };
  const ui = await mount(<NewTaskPage data={data} create={create} created={jest.fn()} back={jest.fn()} />);
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "Review");
  await fireEvent.press(ui.getByText(t("tkPriority")));
  await fireEvent.press(ui.getByText(t("tkPrioUrgent")));
  await fireEvent.press(ui.getByText(t("tkProject")));
  await fireEvent.press(ui.getByText("Acme"));
  await fireEvent.press(ui.getByText(t("tkAssignee")));
  await fireEvent.press(ui.getByText("April"));
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Review", priority: "urgent", project: project.id, assignee: "april" }),
  );
  await ui.unmount();
});

test("task creation failure keeps the draft and duplicate submissions stay blocked while retry is pending", async () => {
  const pending = deferred<Task>();
  const create = jest
    .fn<Promise<Task>, []>()
    .mockRejectedValueOnce(new Error("Core offline"))
    .mockReturnValueOnce(pending.promise);
  const created = jest.fn();
  const alert = jest.spyOn(Alert, "alert");
  const ui = await mount(
    <NewTaskPage data={{ ...emptyWorkspace, columns: [] }} create={create} created={created} back={jest.fn()} />,
  );
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "Review");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(alert).toHaveBeenCalledWith(t("tkNew"), "Core offline");
  expect(ui.getByLabelText(t("tkTitle"))).toHaveDisplayValue("Review");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ status: "backlog", description: undefined }));
  expect(ui.getByRole("button", { name: t("tkCreate") })).toBeDisabled();
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(task));
  expect(created).toHaveBeenCalledWith(task);
  await ui.unmount();
});
