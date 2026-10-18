import { act, renderHook } from "@testing-library/react-native";
import { useConnection } from "../src/hooks/useConnection";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("a connected or still-loading phone makes no public connectivity probes", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
  const hook = await renderHook(
    ({ online, loading }: { online: boolean; loading: boolean }) =>
      useConnection("http://192.168.1.5:7440", online, loading),
    { initialProps: { online: true, loading: false } },
  );
  await act(() => jest.advanceTimersByTimeAsync(20000));
  expect(fetch).not.toHaveBeenCalled();
  expect(hook.result.current.offline).toBeUndefined();
  await hook.rerender({ online: false, loading: true });
  await act(() => jest.advanceTimersByTimeAsync(20000));
  expect(fetch).not.toHaveBeenCalled();
  await hook.unmount();
});

test("an outage waits its grace period, diagnoses the paired address and rechecks every fifteen seconds", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
  const hook = await renderHook(() => useConnection("http://192.168.1.5:7440", false, false));
  await act(() => jest.advanceTimersByTimeAsync(2999));
  expect(fetch).not.toHaveBeenCalled();
  expect(hook.result.current.offline).toBeUndefined();
  await act(() => jest.advanceTimersByTimeAsync(1));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(hook.result.current.offline).toBe("localNetwork");
  expect(hook.result.current.checking).toBe(false);
  await act(() => jest.advanceTimersByTimeAsync(15000));
  expect(fetch).toHaveBeenCalledTimes(4);
  await hook.unmount();
  await act(() => jest.advanceTimersByTimeAsync(60000));
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("failed probes explain no internet, while reconnecting immediately clears the diagnosis", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network offline"));
  const hook = await renderHook((online: boolean) => useConnection("https://office.ts.net", online, false), {
    initialProps: false,
  });
  await act(() => jest.advanceTimersByTimeAsync(3000));
  expect(hook.result.current.offline).toBe("noInternet");
  expect(hook.result.current.checking).toBe(false);
  await hook.rerender(true);
  expect(hook.result.current.offline).toBeUndefined();
  const count = fetch.mock.calls.length;
  await act(() => jest.advanceTimersByTimeAsync(30000));
  expect(fetch).toHaveBeenCalledTimes(count);
  await hook.unmount();
});

test("manual diagnosis uses the current server address after props change", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
  const hook = await renderHook((url: string) => useConnection(url, false, false), {
    initialProps: "https://office.ts.net",
  });
  await act(() => hook.result.current.check());
  expect(hook.result.current.offline).toBe("tailscale");
  await hook.rerender("https://apx.example.com");
  await act(() => hook.result.current.check());
  expect(hook.result.current.offline).toBe("server");
  await hook.unmount();
});

test("unmounting during an in-flight probe schedules no later retries", async () => {
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = jest.spyOn(globalThis, "fetch").mockReturnValue(pending);
  const hook = await renderHook(() => useConnection("http://localhost:7440", false, false));
  await act(() => jest.advanceTimersByTimeAsync(3000));
  expect(hook.result.current.checking).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await hook.unmount();
  await act(async () => {
    finish({ ok: true } as Response);
  });
  await act(() => jest.advanceTimersByTimeAsync(60000));
  expect(fetch).toHaveBeenCalledTimes(2);
});
