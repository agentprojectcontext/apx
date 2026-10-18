import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace, type Routine } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { RoutineDetailPage } from "../src/pages/RoutineDetailPage";
import { RoutinesPage, RoutineToggle, RunNow, useRoutineRuns } from "../src/pages/RoutinesPage";
import type { RoutineRun } from "../src/protocol";
import { deferred } from "./transport.test-support";

const routine: Routine = {
  id: "rt_one",
  name: "Review",
  enabled: true,
  agent_id: "april",
  schedule: { kind: "manual" },
  action: "agent",
  prompt: "Review changes",
  call_model: "always",
  anchor: false,
};
const run: RoutineRun = {
  run_id: "run_one",
  thread_id: "thr_one",
  state: "completed",
  started_at: "2026-10-18T10:00:00Z",
  model_called: true,
  delivered: true,
};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (children: React.ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>);
const actions = () => ({
  toggle: jest.fn(async () => {}),
  run: jest.fn(async () => {}),
  runs: jest.fn(async () => [run]),
});

test("routine toggles show pending state, prevent duplicate calls and restore the previous value after failure", async () => {
  const pending = deferred<void>();
  const toggle = jest.fn(() => pending.promise);
  const alert = jest.spyOn(Alert, "alert");
  const ui = await mount(<RoutineToggle routine={routine} toggle={toggle} />);
  const control = () => ui.getByRole("switch", { name: t("rtEnabled") });
  expect(control()).toBeChecked();
  await fireEvent.press(control());
  expect(toggle).toHaveBeenCalledWith(routine, false);
  expect(control()).not.toBeChecked();
  expect(control()).toBeDisabled();
  await fireEvent.press(control());
  expect(toggle).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Core offline")));
  expect(control()).toBeChecked();
  expect(control()).toBeEnabled();
  expect(alert).toHaveBeenCalledWith(routine.name, "Core offline");
  await ui.rerender(<RoutineToggle routine={{ ...routine, enabled: false }} toggle={toggle} />);
  expect(control()).not.toBeChecked();
  await ui.unmount();
});

test("run now blocks duplicate runs and becomes available again after completion or failure", async () => {
  const first = deferred<void>();
  const execute = jest
    .fn<Promise<void>, [string]>()
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error("Run refused"));
  const alert = jest.spyOn(Alert, "alert");
  const ui = await mount(<RunNow routine={routine} run={execute} />);
  const button = () => ui.getByRole("button", { name: t("rtRunNow") });
  await fireEvent.press(button());
  expect(execute).toHaveBeenCalledWith(routine.id);
  expect(button()).toBeDisabled();
  await fireEvent.press(button());
  expect(execute).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(undefined));
  expect(button()).toBeEnabled();
  await fireEvent.press(button());
  expect(alert).toHaveBeenCalledWith(routine.name, "Run refused");
  expect(button()).toBeEnabled();
  await ui.unmount();
});

test("the routine list sorts enabled routines first and opens the selected routine", async () => {
  const api = actions();
  const open = jest.fn();
  const back = jest.fn();
  const second = { ...routine, id: "rt_two", name: "Disabled", enabled: false };
  const ui = await mount(
    <RoutinesPage data={{ ...emptyWorkspace, routines: [second, routine] }} actions={api} open={open} back={back} />,
  );
  expect(ui.getAllByText(/^(Review|Disabled)$/).map((node) => node.props.children)).toEqual(["Review", "Disabled"]);
  expect(ui.getByText(t("rtSummary", { on: 1, all: 2 }))).toBeVisible();
  await fireEvent.press(ui.getByText("Review"));
  expect(open).toHaveBeenCalledWith(routine);
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  expect(back).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("routine detail loads twenty runs, opens a run's conversation and exposes editing", async () => {
  const api = actions();
  const openThread = jest.fn();
  const edit = jest.fn();
  const ui = await mount(
    <RoutineDetailPage
      routine={routine}
      data={emptyWorkspace}
      actions={api}
      openThread={openThread}
      edit={edit}
      back={jest.fn()}
    />,
  );
  expect(api.runs).toHaveBeenCalledWith(routine.id, 20);
  expect(ui.getByText(routine.prompt)).toBeVisible();
  await fireEvent.press(ui.getByText(t("rtTold")));
  expect(openThread).toHaveBeenCalledWith(run.thread_id);
  await fireEvent.press(ui.getByRole("button", { name: t("rtEdit") }));
  expect(edit).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("routine runs reload when a live run finishes and preserve current data if refresh fails", async () => {
  const load = jest.fn(async () => [run]);
  const pending = { ...run, state: "running" };
  const ui = await renderHook(({ selected }: { selected: Routine }) => useRoutineRuns(selected, load), {
    initialProps: { selected: { ...routine, last: pending } },
  });
  expect(ui.result.current).toEqual([run]);
  expect(load).toHaveBeenCalledTimes(1);
  load.mockRejectedValueOnce(new Error("Offline"));
  await ui.rerender({ selected: { ...routine, last: run } });
  expect(load).toHaveBeenCalledTimes(2);
  expect(ui.result.current).toEqual([run]);
  await ui.unmount();
});

test("switching routines hides previous runs and discards an old response that arrives later", async () => {
  const previous = deferred<RoutineRun[]>();
  const load = jest.fn(async (id: string) => (id === routine.id ? previous.promise : [{ ...run, run_id: "run_new" }]));
  const ui = await renderHook(({ selected }: { selected: Routine }) => useRoutineRuns(selected, load), {
    initialProps: { selected: routine },
  });
  await ui.rerender({ selected: { ...routine, id: "rt_two" } });
  expect(ui.result.current.map((r) => r.run_id)).toEqual(["run_new"]);
  await act(async () => previous.resolve([run]));
  expect(ui.result.current.map((r) => r.run_id)).toEqual(["run_new"]);
  await ui.unmount();
});

test("previously loaded runs disappear immediately when another routine is waiting for its history", async () => {
  const pending = deferred<RoutineRun[]>();
  const load = jest.fn(async (id: string) => (id === routine.id ? [run] : pending.promise));
  const ui = await renderHook(({ selected }: { selected: Routine }) => useRoutineRuns(selected, load), {
    initialProps: { selected: routine },
  });
  expect(ui.result.current).toEqual([run]);
  await ui.rerender({ selected: { ...routine, id: "rt_two" } });
  expect(ui.result.current).toEqual([]);
  await act(async () => pending.resolve([{ ...run, run_id: "run_new" }]));
  expect(ui.result.current.map((item) => item.run_id)).toEqual(["run_new"]);
  await ui.unmount();
});

test("a stale same-routine run list cannot overwrite a newer run transition", async () => {
  const pending = deferred<RoutineRun[]>();
  const load = jest
    .fn<Promise<RoutineRun[]>, [string, number?]>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce([run]);
  const ui = await renderHook(({ selected }: { selected: Routine }) => useRoutineRuns(selected, load), {
    initialProps: { selected: routine },
  });
  await ui.rerender({ selected: { ...routine, last: run } });
  expect(ui.result.current).toEqual([run]);
  await act(async () => pending.resolve([]));
  expect(ui.result.current).toEqual([run]);
  await ui.unmount();
});

test("empty routine lists explain the empty state without requesting run histories", async () => {
  const api = actions();
  const ui = await mount(<RoutinesPage data={emptyWorkspace} actions={api} open={jest.fn()} back={jest.fn()} />);
  expect(ui.getByText(t("rtNone"))).toBeVisible();
  expect(ui.getByText(t("rtNoneBody"))).toBeVisible();
  expect(api.runs).not.toHaveBeenCalled();
  await ui.unmount();
});

test("a failed initial run history leaves an empty list and a successful refresh can recover", async () => {
  const load = jest
    .fn<Promise<RoutineRun[]>, [string, number?]>()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce([run]);
  const ui = await renderHook(({ selected }: { selected: Routine }) => useRoutineRuns(selected, load), {
    initialProps: { selected: routine },
  });
  expect(ui.result.current).toEqual([]);
  await ui.rerender({ selected: { ...routine, last: run } });
  expect(ui.result.current).toEqual([run]);
  await ui.unmount();
});
