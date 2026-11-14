import { act, fireEvent, render } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";
import { t } from "../src/i18n";
import type { ApxClient, Message } from "../src/protocol";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const message = (text: string) =>
  ({
    id: "msg_1",
    thread_id: "th_1",
    seq: 1,
    author: { kind: "agent", id: "roby" },
    created_at: "2026-11-13T15:00:00.000Z",
    parts: [{ type: "text", text }],
  }) as unknown as Message;

const client = { call: jest.fn(async () => ({})) } as unknown as ApxClient;
const fence = (lang: string, value: unknown) => `Two ideas.\n\n\`\`\`${lang}\n${JSON.stringify(value)}\n\`\`\``;
const show = (text: string, send?: (text: string) => Promise<unknown>) =>
  render(
    <ChatMessage
      message={message(text)}
      agents={[]}
      client={client}
      respond={async () => {}}
      {...(send ? { send } : {})}
    />,
  );
const first = <T,>(all: T[]): T => {
  const [one] = all;
  if (!one) throw new Error("nothing found");
  return one;
};
const press = (node: Parameters<typeof fireEvent.press>[0]) => act(async () => fireEvent.press(node));

test("an agent's results show as cards on the phone, and their details open", async () => {
  const ui = await show(
    fence("apx-cards", {
      title: "Movie ideas",
      example: true,
      fallback: "The quiet moon and Northbound.",
      items: [
        {
          id: "moon",
          eyebrow: "Movie · 2024",
          title: "The quiet moon",
          badges: ["Drama"],
          fields: [{ label: "Length", value: "108 min" }],
          details: "An invented journey to the moon.",
          image: "https://example.com/moon.jpg",
          images: ["https://example.com/moon-2.jpg"],
          highlight: { value: "4.5 / 5", label: "Rating" },
          action: { label: "Watch it", url: "https://example.com/watch/moon" },
        },
        { id: "north", title: "Northbound" },
      ],
    }),
  );
  expect(ui.getByText("Movie ideas")).toBeTruthy();
  expect(ui.getByText(t("inlineExample"))).toBeTruthy();
  expect(ui.getByText("Movie · 2024")).toBeTruthy();
  expect(ui.getByText("4.5 / 5")).toBeTruthy();
  expect(ui.queryByText("108 min")).toBeNull();
  expect(ui.getByText("Northbound")).toBeTruthy();
  expect(ui.queryByText("An invented journey to the moon.")).toBeNull();
  await act(async () => fireEvent.press(ui.getByText(t("inlineDetails"))));
  expect(ui.getByText("An invented journey to the moon.")).toBeTruthy();
  expect(ui.getByText("108 min")).toBeTruthy();
  expect(ui.queryByText(/"items"/)).toBeNull();
  expect(ui.getByText("1 / 2")).toBeTruthy();
  expect(ui.getAllByText("+1")[0]).toBeTruthy();
  expect(first(ui.getAllByLabelText("The quiet moon")).props.source).toEqual({ uri: "https://example.com/moon.jpg" });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await press(first(ui.getAllByText("Watch it")));
  expect(open).toHaveBeenCalledWith("https://example.com/watch/moon");
});

test("an A2UI block the phone cannot draw shows its fallback text, not its code", async () => {
  const ui = await show(
    fence("a2ui", {
      fallback: "Buy it from the store's page.",
      messages: [
        {
          version: "1.0",
          createSurface: {
            surfaceId: "b",
            catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
          },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "b",
            components: [{ id: "root", component: "Button", child: "x", action: { event: { name: "buy" } } }],
          },
        },
      ],
    }),
  );
  expect(ui.getByText("Buy it from the store's page.")).toBeTruthy();
  expect(ui.queryByText(/createSurface/)).toBeNull();
});

const headphones = {
  view: "choice",
  title: "Wireless headphones",
  subtitle: "Up to $120,000",
  note: "Prices at 14:20",
  fallback: "Pulse Pro or Mist Lite.",
  quantity: 5,
  options: [
    { id: "a", title: "Mist Lite", badge: { label: "Best price", tone: "success" }, price: "$64,900", rating: "4.2" },
    { id: "b", title: "Pulse Pro", badge: "Recommended", price: "$98,500", was: "$118,000" },
  ],
  submit: { label: "Go with this one", ask: "I want {quantity} {option} ({price}). Confirm before paying." },
  buttons: [{ label: "More options", ask: "Show me more headphones" }],
};

test("choosing one option with how many writes it to the chat once, filled in", async () => {
  const send = jest.fn(async () => {});
  const ui = await show(fence("apx-cards", headphones), send);
  expect(ui.getByText("Wireless headphones")).toBeTruthy();
  expect(ui.getByText("Prices at 14:20")).toBeTruthy();
  expect(ui.getByText("4.2")).toBeTruthy();
  expect(ui.getByText(t("inlineChooseOption"))).toBeTruthy();
  await press(ui.getByText("Go with this one"));
  expect(send).not.toHaveBeenCalled();
  await press(ui.getByText("Pulse Pro"));
  await press(ui.getByLabelText(t("inlineMore")));
  expect(ui.getByText("Pulse Pro × 2")).toBeTruthy();
  await press(ui.getByText("Go with this one"));
  expect(send).toHaveBeenCalledWith("I want 2 Pulse Pro ($98,500). Confirm before paying.");
  await press(ui.getByLabelText(`Go with this one, ${t("inlineSent")}`));
  expect(send).toHaveBeenCalledTimes(1);
  await press(ui.getByText("More options"));
  expect(send).toHaveBeenLastCalledWith("Show me more headphones");
});

test("without a way to write to the chat, a card's asking buttons are not offered", async () => {
  const ui = await show(fence("apx-cards", headphones));
  expect(ui.getByText("Pulse Pro")).toBeTruthy();
  expect(ui.queryByText("More options")).toBeNull();
  expect(ui.queryByText("Go with this one")).toBeNull();
});

test("booking: a closed day or time cannot be picked, and the button waits for both", async () => {
  const send = jest.fn(async () => {});
  const ui = await show(
    fence("apx-cards", {
      view: "booking",
      fallback: "Forest Inn has tables tonight.",
      place: { eyebrow: "Restaurant", title: "Forest Inn", rating: "4.6", meta: "Patagonian · $$" },
      days: [
        { label: "Today", sub: "Fri 14" },
        { label: "Mon", sub: "closed", off: true },
      ],
      times: ["20:00", { label: "20:30", off: true }, "21:00"],
      people: { min: 1, max: 8, value: 2 },
      note: "Deposit of $10,000 per person",
      submit: "Book",
    }),
    send,
  );
  expect(ui.getByText("Deposit of $10,000 per person")).toBeTruthy();
  await press(ui.getByText("Mon"));
  await press(ui.getByText("20:30"));
  expect(ui.getByText(t("inlineChooseTime"))).toBeTruthy();
  await press(ui.getByText("Today"));
  await press(ui.getByText("Book"));
  expect(send).not.toHaveBeenCalled();
  await press(ui.getByText("21:00"));
  await press(ui.getByLabelText(t("inlineMore")));
  const people = t("inlinePeople", { n: 3 });
  expect(ui.getByText(`Today Fri 14 · 21:00 · ${people}`)).toBeTruthy();
  await press(ui.getByText("Book"));
  expect(send).toHaveBeenCalledWith(
    t("inlineBookAsk", { day: "Today Fri 14", time: "21:00", people, what: "Forest Inn" }),
  );
});

test("comparing: tapping an option's header picks it, and the button goes with it", async () => {
  const send = jest.fn(async () => {});
  const ui = await show(
    fence("apx-cards", {
      view: "compare",
      title: "Hosting",
      fallback: "Acme or your own server.",
      columns: [{ title: "Acme" }, { title: "Own server", badge: { label: "Cheapest", tone: "brand" } }],
      rows: [
        { label: "Monthly", values: ["US$ 35", "US$ 12"], best: [1] },
        { label: "Deploy", values: ["Push", "Manual"] },
      ],
      submit: { label: "Go with {option}" },
    }),
    send,
  );
  expect(ui.getByText("US$ 12")).toBeTruthy();
  expect(ui.getByText("Cheapest")).toBeTruthy();
  expect(ui.queryByText("Go with Acme")).toBeNull();
  await press(ui.getByText("Acme"));
  await press(ui.getByText("Go with Acme"));
  expect(send).toHaveBeenCalledWith(t("inlineCompareAsk", { option: "Acme" }));
  await press(ui.getByText("Own server"));
  await press(ui.getByText("Go with Own server"));
  expect(send).toHaveBeenLastCalledWith(t("inlineCompareAsk", { option: "Own server" }));
});

test("places: picking one in the list gives the way there and its page", async () => {
  const ui = await show(
    fence("apx-cards", {
      view: "places",
      title: "Cafés nearby",
      fallback: "Harbour café and North bakery.",
      origin: { lat: -41.134, lng: -71.3 },
      places: [
        { id: "c1", title: "Harbour café", meta: "Coffee · 300 m", lat: -41.13, lng: -71.31 },
        {
          id: "c2",
          title: "North bakery",
          rating: "4.8",
          status: { label: "Open now", tone: "success" },
          lat: -41.12,
          lng: -71.29,
          url: "https://example.com/bakery",
        },
      ],
    }),
  );
  expect(ui.getByText(t("inlineSchematicMap"))).toBeTruthy();
  expect(ui.getByText("Coffee · 300 m")).toBeTruthy();
  expect(ui.getByText("Open now")).toBeTruthy();
  expect(ui.queryByText(t("inlineOpen"))).toBeNull();
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await press(ui.getByText("North bakery"));
  await press(ui.getByText(t("inlineDirections")));
  expect(open).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=-41.12,-71.29");
  await press(ui.getByText(t("inlineOpen")));
  expect(open).toHaveBeenLastCalledWith("https://example.com/bakery");
});

test("a confirmation shows its status, copies its code and keeps its buttons", async () => {
  const send = jest.fn(async () => {});
  const ui = await show(
    fence("apx-cards", {
      view: "receipt",
      fallback: "Booked: table for 2 at Forest Inn, code HB-48213.",
      title: "Table for 2 · Forest Inn",
      status: { label: "Confirmed" },
      when: "1 min ago",
      fields: [{ label: "When", value: "Today, 21:00" }],
      code: { label: "Code", value: "HB-48213" },
      steps: { done: 2, total: 3 },
      buttons: [
        { label: "Add to calendar", url: "https://calendar.example.com/add" },
        { label: "Cancel booking", ask: "Cancel my booking at Forest Inn" },
      ],
    }),
    send,
  );
  expect(ui.getByText("Confirmed")).toBeTruthy();
  expect(ui.getByText("1 min ago")).toBeTruthy();
  expect(ui.getByText("Today, 21:00")).toBeTruthy();
  expect(ui.getByLabelText(t("inlineSteps", { done: 2, total: 3 }))).toBeTruthy();
  await press(ui.getByLabelText(`${t("copyText")} HB-48213`));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("HB-48213");
  expect(ui.getByText(t("copied"))).toBeTruthy();
  await press(ui.getByText("Cancel booking"));
  expect(send).toHaveBeenCalledWith("Cancel my booking at Forest Inn");
});

test("a plan by days shows one day at a time", async () => {
  const ui = await show(
    fence("apx-cards", {
      view: "agenda",
      title: "Your weekend",
      fallback: "Saturday: leave at 9. Sunday: hike.",
      days: [
        { label: "Sat 15", items: [{ time: "09:00", title: "Leave", done: true }, { title: "Dinner" }] },
        { label: "Sun 16", items: [{ time: "08:00", title: "Hike", meta: "Bring water" }] },
      ],
    }),
  );
  expect(ui.getByText("Leave")).toBeTruthy();
  expect(ui.queryByText("Hike")).toBeNull();
  await press(ui.getByText("Sun 16"));
  expect(ui.getByText("Hike")).toBeTruthy();
  expect(ui.getByText("Bring water")).toBeTruthy();
  expect(ui.queryByText("Leave")).toBeNull();
});
