import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mounted } from "./browser.test-support.ts";

test("date ranges navigate months, restart before the start date, finish a range and clear it", async () =>
  mounted(async (page) => {
    const trigger = page.getByRole("button", { name: "Date range", exact: true });
    await trigger.click();
    await expect(page.getByText("February 2024", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(page.getByText("March 2024", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous month", exact: true }).click();
    await page.locator(".apx-cal__day:not(.is-outside)").filter({ hasText: /^5$/ }).click();
    await expect(page.getByTestId("range")).toHaveText('{"from":"2024-02-05"}');
    await page.getByRole("button", { name: "20", exact: true }).hover();
    await expect(page.locator(".apx-cal__day.is-inrange")).toHaveCount(14);
    await page.getByRole("button", { name: "20", exact: true }).click();
    await expect(page.getByTestId("range")).toHaveText('{"from":"2024-02-05","to":"2024-02-20"}');
    await expect(page.getByText("February 2024", { exact: true })).toHaveCount(0);
    await trigger.click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByTestId("range")).toHaveText("{}");
  }));

test("master detail remembers a resized width across remount and reset restores its default", async () =>
  mounted(async (page) => {
    const splitter = page.getByRole("separator", { name: "Resource width", exact: true });
    await splitter.focus();
    await splitter.press("ArrowRight");
    await expect(splitter).toHaveAttribute("aria-valuenow", "356");
    assert.equal(await page.evaluate(() => localStorage.getItem("apx.mdetail.coverage-fixture")), "356");
    await page.reload();
    await expect(splitter).toHaveAttribute("aria-valuenow", "356");
    await splitter.dblclick();
    await expect(splitter).toHaveAttribute("aria-valuenow", "340");
    assert.equal(await page.evaluate(() => localStorage.getItem("apx.mdetail.coverage-fixture")), "340");
  }));

test("voice playback updates progress, stops on end and removes exact media listeners on replacement and unmount", async () =>
  mounted(async (page) => {
    await page.evaluate(() => {
      const records: {
        audio: EventTarget & { currentTime: number };
        plays: number;
        pauses: number;
        removed: string[];
      }[] = [];
      Object.assign(window, { testAudio: records });
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: class extends EventTarget {
          currentTime = 0;
          preload = "";
          record = { audio: this, plays: 0, pauses: 0, removed: [] as string[] };
          listeners = new Map<string, EventListenerOrEventListenerObject | null>();
          constructor() {
            super();
            records.push(this.record);
          }
          play() {
            this.record.plays++;
            return Promise.resolve();
          }
          pause() {
            this.record.pauses++;
          }
          override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
            this.listeners.set(type, listener);
            super.addEventListener(type, listener);
          }
          override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
            if (this.listeners.get(type) !== listener) throw new Error("Wrong media listener removed");
            this.record.removed.push(type);
            super.removeEventListener(type, listener);
          }
        },
      });
    });
    const voice = page.locator(".apx-voice");
    await expect(voice.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Load voice", exact: true }).click();
    await voice.getByRole("button", { name: "Play", exact: true }).click();
    await expect(voice.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const update = async (event: "timeupdate" | "ended") =>
      page.evaluate((event) => {
        const records = (window as unknown as { testAudio: { audio: EventTarget & { currentTime: number } }[] })
          .testAudio;
        const current = records.at(-1);
        if (!current) throw new Error("No audio created");
        current.audio.currentTime = 30;
        current.audio.dispatchEvent(new Event(event));
      }, event);
    await update("timeupdate");
    await expect(voice.locator(".apx-voice__time")).toHaveText("0:30 / 2:00");
    await expect(voice.locator(".apx-voice__fill")).toHaveAttribute("style", "width: 25%;");
    await voice.getByRole("button", { name: "Pause", exact: true }).click();
    await voice.getByRole("button", { name: "Play", exact: true }).click();
    await update("ended");
    await expect(voice.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Replace voice", exact: true }).click();
    await page.getByRole("button", { name: "Remove voice", exact: true }).click();
    await expect(voice).toHaveCount(0);
    const cleanup = await page.evaluate(() =>
      (window as unknown as { testAudio: { plays: number; pauses: number; removed: string[] }[] }).testAudio.map(
        ({ plays, pauses, removed }) => ({ plays, pauses, removed }),
      ),
    );
    assert.deepEqual(cleanup, [
      { plays: 2, pauses: 2, removed: ["timeupdate", "ended"] },
      { plays: 0, pauses: 1, removed: ["timeupdate", "ended"] },
    ]);
  }));
