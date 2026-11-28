import { act, fireEvent, render } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { CarAlert, CarStatus, CarTripView } from "../../../packages/protocol/src/car";
import type { CarNativeStatus } from "../src/car/native";
import { emptyWorkspace, type Task } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { CarModePage } from "../src/pages/CarModePage";
import { NewTaskPage } from "../src/pages/NewTaskPage";
import { TasksPage } from "../src/pages/TasksPage";
import { TripPage } from "../src/pages/TripPage";
import { ErrandPlaceEditor } from "../src/tasks/ErrandPlaceFields";
import { credentials } from "./transport.test-support";

const mockNative = {
  available: true,
  status: {
    available: true,
    enabled: true,
    listener: false,
    location: true,
    notifications: true,
    car_connected: false,
  } as CarNativeStatus,
  openListenerSettings: jest.fn(async () => undefined),
  startTestTrip: jest.fn(async () => undefined),
  stopTestTrip: jest.fn(async () => undefined),
};
jest.mock("../src/car/native", () => ({
  carNative: {
    get available() {
      return mockNative.available;
    },
    configure: async () => undefined,
    allowTrips: async () => undefined,
    pauseTrips: async () => undefined,
    status: async () => mockNative.status,
    openListenerSettings: () => mockNative.openListenerSettings(),
    startTestTrip: () => mockNative.startTestTrip(),
    stopTestTrip: () => mockNative.stopTestTrip(),
    onStatus: () => () => undefined,
  },
}));
jest.mock("expo-notifications", () => ({
  ...jest.requireActual("expo-notifications"),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true, canAskAgain: true, expires: "never" })),
  getPresentedNotificationsAsync: jest.fn(async () => []),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (children: React.ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>);
const coreStatus = (enabled: boolean): CarStatus => ({
  settings: { enabled, reach: "normal", source: "osm", tell_in_chat: false, voice_while_driving: true },
  google_key: false,
  phone: false,
});

test("an errand's place on a new task: picked categories in order and the brand reach creation", async () => {
  const task = { id: "tsk_errand", kind: "errand" } as Task;
  const create = jest.fn(async () => task);
  const ui = await mount(<NewTaskPage data={emptyWorkspace} create={create} created={jest.fn()} back={jest.fn()} />);
  await fireEvent.changeText(ui.getByLabelText(t("tkTitle")), "Comprar leche");
  expect(ui.queryByText(t("carCatSupermarket"))).toBeNull();
  await fireEvent.press(ui.getByText(t("tkType")));
  await fireEvent.press(ui.getByText(t("tkTypeErrand")));
  await fireEvent.press(ui.getByRole("button", { name: t("carCatKiosk") }));
  await fireEvent.press(ui.getByRole("button", { name: t("carCatSupermarket") }));
  await fireEvent.changeText(ui.getByLabelText(t("carPlaceBrand")), " Acme ");
  await fireEvent.press(ui.getByRole("button", { name: t("tkCreate") }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "errand", place: { categories: ["kiosk", "supermarket"], brand: "Acme" } }),
  );
  await ui.unmount();
});

test("a task's place saves on each pick and the brand when its field is left", async () => {
  const save = jest.fn();
  const ui = await mount(<ErrandPlaceEditor place={{ categories: ["pharmacy"] }} save={save} />);
  expect(ui.getByRole("button", { name: t("carCatPharmacy") })).toBeSelected();
  await fireEvent.press(ui.getByRole("button", { name: t("carCatPharmacy") }));
  expect(save).toHaveBeenLastCalledWith(null);
  await fireEvent.changeText(ui.getByLabelText(t("carPlaceBrand")), "Northwind");
  expect(save).toHaveBeenCalledTimes(1);
  await fireEvent(ui.getByLabelText(t("carPlaceBrand")), "endEditing");
  expect(save).toHaveBeenLastCalledWith({ categories: [], brand: "Northwind" });
  await ui.unmount();
});

test("without the native side, car mode says only that it needs the newer Android app", async () => {
  mockNative.available = false;
  const call = jest.fn();
  const ui = await mount(<CarModePage creds={credentials} call={call} back={jest.fn()} />);
  expect(ui.getByText(t("carUnavailable"))).toBeVisible();
  expect(ui.queryByRole("switch")).toBeNull();
  expect(call).not.toHaveBeenCalled();
  await ui.unmount();
  mockNative.available = true;
});

test("the phone holds only its own switch: it tells the core, waits for APX to be on, then lists what to allow", async () => {
  jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue(null);
  const stored = jest.spyOn(SecureStore, "setItemAsync").mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  let globalOn = false;
  const call = jest.fn(async (method: string, _params: Record<string, unknown>) =>
    method === "car.phone" ? {} : coreStatus(globalOn),
  );
  const ui = await mount(<CarModePage creds={credentials} call={call} back={jest.fn()} />);
  await act(async () => undefined);
  expect(ui.getAllByRole("switch")).toHaveLength(1);
  expect(ui.getByText(t("carSwitch")).props.numberOfLines).toBeUndefined();
  expect(ui.getByText(t("carSwitchHelp")).props.numberOfLines).toBeUndefined();
  expect(ui.queryByText(t("carNeedListener"))).toBeNull();
  await fireEvent.press(ui.getByRole("switch", { name: t("carSwitch") }));
  await act(async () => undefined);
  expect(alert).toHaveBeenCalledWith(t("carMode"), t("carCoreOff"));
  expect(stored).not.toHaveBeenCalledWith("apx.car.enabled", "on");
  globalOn = true;
  await fireEvent.press(ui.getByRole("switch", { name: t("carSwitch") }));
  await act(async () => undefined);
  expect(call).toHaveBeenCalledWith("car.phone", { enabled: true });
  expect(call).not.toHaveBeenCalledWith("car.configure", expect.anything());
  expect(stored).toHaveBeenCalledWith("apx.car.enabled", "on");
  expect(ui.getByText(t("carNeedListener"))).toBeVisible();
  expect(ui.getByText(t("carNeedsSetup"))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("carAllow") }));
  expect(mockNative.openListenerSettings).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: t("carTest") }));
  expect(mockNative.startTestTrip).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("a phone turned off from APX on the computer switches itself off, and only the phone turns it on again", async () => {
  jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue("on");
  const stored = jest.spyOn(SecureStore, "setItemAsync").mockResolvedValue(undefined);
  const call = jest.fn(async (_method: string, _params: Record<string, unknown>) => ({
    ...coreStatus(true),
    this_phone: false,
  }));
  const ui = await mount(<CarModePage creds={credentials} call={call} back={jest.fn()} />);
  await act(async () => undefined);
  expect(stored).toHaveBeenCalledWith("apx.car.enabled", "off");
  expect(ui.getByRole("switch", { name: t("carSwitch") })).not.toBeChecked();
  stored.mockClear();
  await fireEvent.press(ui.getByRole("switch", { name: t("carSwitch") }));
  await act(async () => undefined);
  expect(call).toHaveBeenCalledWith("car.phone", { enabled: true });
  expect(ui.getByRole("switch", { name: t("carSwitch") })).toBeChecked();
  expect(stored).not.toHaveBeenCalledWith("apx.car.enabled", "off");
  await ui.unmount();
});

test("a trip's offer shows its place and distance, and each answer reaches the core", async () => {
  const alert: CarAlert = {
    id: "alr_1",
    trip_id: "trip-0001",
    task_id: "tsk_errand",
    errand: "Comprar leche",
    place: { key: "osm:node/1", name: "Acme Market", lat: 0, lon: 0, source: "osm" },
    distance_m: 900,
    distance_label: "900 m",
    title: "Comprar leche en Acme Market",
    spoken: "Comprar leche en Acme Market, a novecientos metros",
    actions: ["navigate", "next", "later", "skip", "done"],
    navigate_url: "https://www.google.com/maps/dir/?api=1&destination=0,0",
    at: "2026-11-27T10:00:00Z",
  };
  const view: CarTripView = {
    trip: { id: "trip-0001", source: "android_auto", started_at: "2026-11-27T09:50:00Z", silenced: false },
    alerts: [alert],
    errands: [{ task_id: "tsk_other", title: "Pagar la luz", held: "later" }],
  };
  const answer = jest.fn(async () => undefined);
  const ui = await mount(<TripPage view={view} answer={answer} back={jest.fn()} />);
  expect(ui.getByText("Acme Market")).toBeVisible();
  expect(ui.getByText("900 m")).toBeVisible();
  expect(ui.getByText("Pagar la luz")).toBeVisible();
  expect(ui.getByText(t("carOsmCredit"))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("carAnswerGo") }));
  expect(answer).toHaveBeenCalledWith("alr_1", "navigate");
  await fireEvent.press(ui.getByRole("button", { name: t("carAnswerDone") }));
  expect(answer).toHaveBeenLastCalledWith("alr_1", "done");
  await ui.unmount();
});

test("with no trip, the trip page says it starts when the car connects", async () => {
  const ui = await mount(<TripPage view={{ alerts: [], errands: [] }} answer={jest.fn()} back={jest.fn()} />);
  expect(ui.getByText(t("carNoTrip"))).toBeVisible();
  await ui.unmount();
});

test("during a trip the tasks tab leads with its banner, and errand rows show their kind of shop", async () => {
  const errand = {
    id: "tsk_errand",
    title: "Comprar leche",
    status: "todo",
    state: "open",
    kind: "errand",
    place: { categories: ["supermarket", "kiosk"] },
    priority: "normal",
    awaits_owner: false,
    thread_id: "thr_errand",
    activity_at: "2026-11-27T10:00:00Z",
  } as Task;
  const open = jest.fn();
  const actions = { detail: jest.fn(), update: jest.fn(), close: jest.fn(), remove: jest.fn(), comment: jest.fn() };
  const ui = await mount(
    <TasksPage
      data={{ ...emptyWorkspace, tasks: [errand] }}
      actions={actions as never}
      open={jest.fn()}
      create={jest.fn()}
      openThread={jest.fn()}
      trip={{ waiting: 2, open }}
    />,
  );
  await fireEvent.press(ui.getByRole("button", { name: `${t("carTripOn")} · ${t("carNearby", { n: 2 })}` }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(ui.getByText(`${t("carCatSupermarket")} +1`)).toBeVisible();
  await ui.unmount();
});
