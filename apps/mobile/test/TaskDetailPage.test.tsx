import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace, type Task } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { TaskDetailPage } from "../src/pages/TaskDetailPage";
import type { TaskComment } from "../src/tasks/comments";
import type { TaskActions } from "../src/tasks/TaskMenu";
import { deferred } from "./transport.test-support";

const task: Task = {
  id: "tsk_one",
  title: "Review",
  description: "Read changes",
  kind: "task",
  priority: "normal",
  status: "todo",
  state: "open",
  awaits_owner: false,
  thread_id: "thr_task",
  activity_at: "2026-10-18T10:00:00Z",
};
const detail = (comments: TaskComment[] = []) => ({ events: [], comments, sessions: [] });
const actions = () => ({
  detail: jest.fn(async (_id: string) => detail()),
  update: jest.fn(async () => task),
  close: jest.fn(async () => task),
  remove: jest.fn(async () => {}),
  comment: jest.fn(async () => {}),
});
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const view = (selected: Task | undefined, api: TaskActions, back = jest.fn()) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <TaskDetailPage task={selected} data={emptyWorkspace} actions={api} back={back} openThread={jest.fn()} />
  </SafeAreaProvider>
);

test("a missing task shows the deleted state and keeps back navigation available", async () => {
  const api = actions();
  const back = jest.fn();
  const ui = await render(view(undefined, api, back));
  expect(ui.getByText(t("tkGone"))).toBeVisible();
  expect(api.detail).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  expect(back).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("title editing trims a changed value and cancelling an edit sends no update", async () => {
  const api = actions();
  const ui = await render(view(task, api));
  await fireEvent.press(ui.getByLabelText(`${t("tkEdit")}: ${t("tkTitle")}`));
  expect(ui.getByRole("button", { name: t("save") })).toBeDisabled();
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "  Updated review  ");
  await fireEvent.press(ui.getByRole("button", { name: t("save") }));
  expect(api.update).toHaveBeenCalledWith(task.id, { title: "Updated review" });
  await fireEvent.press(ui.getByLabelText(`${t("tkEdit")}: ${t("tkTitle")}`));
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "Do not save");
  await fireEvent.press(ui.getByRole("button", { name: t("cancel") }));
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(ui.getByText(task.title)).toBeVisible();
  await ui.unmount();
});

test("comments preserve the draft until success, prevent duplicate sends and reload detail", async () => {
  const api = actions();
  const pending = deferred<void>();
  api.comment.mockReturnValue(pending.promise);
  const ui = await render(view(task, api));
  await fireEvent.changeText(ui.getByLabelText(t("tkComment")), "  @april Please review  ");
  await fireEvent.press(ui.getByRole("button", { name: t("send") }));
  expect(api.comment).toHaveBeenCalledWith(task.id, "@april Please review");
  expect(ui.getByRole("button", { name: t("send") })).toBeDisabled();
  await fireEvent.press(ui.getByRole("button", { name: t("send") }));
  expect(api.comment).toHaveBeenCalledTimes(1);
  expect(ui.getByLabelText(t("tkComment"))).toHaveDisplayValue("  @april Please review  ");
  await act(async () => pending.resolve(undefined));
  expect(ui.getByLabelText(t("tkComment"))).toHaveDisplayValue("");
  expect(api.detail).toHaveBeenCalledTimes(2);
  await ui.unmount();
});

test("a failed comment keeps its text and shows the error instead of silently losing the draft", async () => {
  const api = actions();
  api.comment.mockRejectedValue(new Error("Core offline"));
  const alert = jest.spyOn(Alert, "alert");
  const ui = await render(view(task, api));
  await fireEvent.changeText(ui.getByLabelText(t("tkComment")), "Keep this comment");
  await fireEvent.press(ui.getByRole("button", { name: t("send") }));
  expect(alert).toHaveBeenCalledWith(task.title, "Core offline");
  expect(ui.getByLabelText(t("tkComment"))).toHaveDisplayValue("Keep this comment");
  expect(ui.getByRole("button", { name: t("send") })).toBeEnabled();
  await ui.unmount();
});

test("an older task detail response cannot replace the comments of the task now on screen", async () => {
  const api = actions();
  const older = deferred<ReturnType<typeof detail>>();
  const comment = (text: string): TaskComment => ({ id: "comment_one", by: "owner", text, at: "2026-10-18T10:00:00Z" });
  api.detail.mockImplementation(async (id: string) =>
    id === task.id ? older.promise : detail([comment("Current task comment")]),
  );
  const ui = await render(view(task, api));
  await ui.rerender(view({ ...task, id: "tsk_two", title: "Second task" }, api));
  expect(ui.getByText("Current task comment")).toBeVisible();
  await act(async () => older.resolve(detail([comment("Previous task comment")])));
  expect(ui.getByText("Current task comment")).toBeVisible();
  expect(ui.queryByText("Previous task comment")).toBeNull();
  await ui.unmount();
});

test("switching tasks hides previous comments while the new detail is loading", async () => {
  const api = actions();
  const pending = deferred<ReturnType<typeof detail>>();
  api.detail.mockResolvedValue(
    detail([{ id: "comment_old", by: "owner", text: "Previous comment", at: "2026-10-18T10:00:00Z" }]),
  );
  const ui = await render(view(task, api));
  expect(ui.getByText("Previous comment")).toBeVisible();
  api.detail.mockReturnValue(pending.promise);
  await ui.rerender(view({ ...task, id: "tsk_two", title: "Second task" }, api));
  expect(ui.queryByText("Previous comment")).toBeNull();
  await act(async () => pending.resolve(detail()));
  expect(ui.queryByText("Previous comment")).toBeNull();
  await ui.unmount();
});

test("a stale same-task refresh cannot replace a newer detail response", async () => {
  const api = actions();
  const pending = deferred<ReturnType<typeof detail>>();
  api.detail.mockReturnValueOnce(pending.promise);
  const ui = await render(view(task, api));
  api.detail.mockResolvedValue(
    detail([{ id: "comment_new", by: "owner", text: "Latest comment", at: "2026-10-18T11:00:00Z" }]),
  );
  await ui.rerender(view({ ...task, activity_at: "2026-10-18T11:00:00Z" }, api));
  expect(ui.getByText("Latest comment")).toBeVisible();
  await act(async () => pending.resolve(detail()));
  expect(ui.getByText("Latest comment")).toBeVisible();
  await ui.unmount();
});

test("a failed same-task refresh preserves the comments already displayed", async () => {
  const api = actions();
  api.detail.mockResolvedValue(
    detail([{ id: "comment_saved", by: "owner", text: "Saved comment", at: "2026-10-18T10:00:00Z" }]),
  );
  const ui = await render(view(task, api));
  api.detail.mockRejectedValue(new Error("Core offline"));
  await ui.rerender(view({ ...task, activity_at: "2026-10-18T11:00:00Z" }, api));
  expect(ui.getByText("Saved comment")).toBeVisible();
  await ui.unmount();
});

test("a comment finishing after navigation cannot start a stale task reload", async () => {
  const api = actions();
  const pending = deferred<void>();
  api.comment.mockReturnValue(pending.promise);
  const ui = await render(view(task, api));
  await fireEvent.changeText(ui.getByLabelText(t("tkComment")), "Finish later");
  await fireEvent.press(ui.getByRole("button", { name: t("send") }));
  await ui.rerender(view({ ...task, id: "tsk_two", title: "Second task" }, api));
  expect(api.detail.mock.calls.map(([id]) => id)).toEqual(["tsk_one", "tsk_two"]);
  await act(async () => pending.resolve(undefined));
  expect(api.detail.mock.calls.map(([id]) => id)).toEqual(["tsk_one", "tsk_two"]);
  await ui.unmount();
});
