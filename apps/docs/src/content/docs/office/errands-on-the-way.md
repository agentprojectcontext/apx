---
title: Errands on the way
description: While you drive, APX finds a place for your errands near the way and asks on the car whether to go.
---

Errands are the small things you do while you're out: buy milk, pick up a parcel, get cash. Turn on **In the car**
and APX watches for them while you drive. When you pass near a place where one of them can be done, it tells you on
the car screen, on the phone and in the panel, and you answer with one tap or by voice.

It starts off. Until you turn it on, the phone runs nothing in the background and APX searches for nothing.

## What you need

- The APX app on an Android phone, paired with your APX ([Your phone](/devices/phone/)). It works the same when APX
  runs on a server: the phone talks to it with its own key, and the app does not have to be open.
- Android Auto in the car, or Google Maps navigating: either one tells APX you're driving.

## Turn it on

1. Open **Settings › In the car** in APX on your computer and enable **Errands on all phones**.
2. On each participating Android phone, enable **Use this phone for errands**. The two switches are independent and initially off. **Settings › Privacy › Location during trips** must also allow sharing.
3. Allow what the list asks for, one tap each: **Read notifications** (how APX sees that Android Auto connected or
   that Maps started a route), **Location** and **Notifications**.
4. Try it without driving: **Try without a car** starts a test trip from where you are.

Turn off **Errands on all phones** on the computer to stop errands everywhere, or **Use this phone for errands** on a phone to stop only that one. The computer also lists your phones under **Phones**: **Turn off** stops one of them from there, and it switches off on its next point. Only the phone turns itself back on. A disconnected phone pauses its GPS after a failed safety check and requires explicit local reactivation. Remote GPS shutdown needs both the core and APK on 2.18.1 or later; older APKs may keep their GPS running while the updated core discards positions. See [Privacy and telemetry](/reference/privacy/#phone-location-is-a-separate-choice) for timing and compatibility limits.

In the panel, **Settings › In the car** has the rest: how far ahead you want to hear about places, where the places
come from, and whether you also want the offer in your chat (Telegram, WhatsApp…).

:::note[An app not installed from the Play Store]
Android Auto only shows the APX car app when **Unknown sources** is on in Android Auto's developer settings (open
Android Auto's settings, tap **Version** ten times, then the menu › **Developer settings**).
:::

## Errands and where they're done

An errand says what kind of place does it: **Supermarket**, **Pharmacy**, **Stationery**, **Hardware**, **Cash
machine**, **Pick up parcels** and so on. When you ask an agent for one ("remind me to buy chips"), it picks the kind
of place itself; on the task form you can change it, add a brand or chain ("La Anónima") or fix one place ("the post
office on Main Street").

An item sold in several kinds of shop gets them all, best first: batteries are **Supermarket**, **Kiosk**,
**Electronics**.

## While you drive

When a place for an errand is ahead of you, close enough, APX offers it once for that errand and that trip:

| Answer | What happens |
|---|---|
| **Go** | Google Maps takes you there. |
| **Add as a stop** | Maps adds it on the way to where you're going. |
| **Another place** | APX looks for the next one for the same errand and never offers this one again on this trip. |
| **Later** | It waits a while (15 minutes or 3 km) and offers it again. |
| **Not this trip** | That errand waits until the next drive. |
| **No more this trip** | No more offers until the car connects again. |
| **Done** | The errand is closed. |

On the car, the APX app lists the offers and your open errands, and has a row to talk to your super-agent. Without
opening it, offers also arrive as messages that Android Auto reads aloud; answer by voice: "voy", "otro",
"después", "no", "ya está", "no me avises más". Anything else you say goes to your super-agent, and its answer is
read back to you.

While you drive, your super-agent answers briefly, and with **Answer with voice while I drive** its replies in your
chat start with a voice note.

## Places you use

Every answer teaches APX about the place: the ones you go to rank first next time, the ones you turn down rank lower.
**Settings › In the car › Places you use** lists them; mark one **Always this one** or **Never**, or forget it.

## Where the places come from

- **OpenStreetMap** (default): free, no key. Places are kept for a week so a drive costs few searches. Most shops
  in OpenStreetMap don't list their hours, so "open now" is often unknown.
- **Google**: add your own Google Maps Platform key (Places API) for better coverage, open now and ratings. Google
  asks for billing on your project even for free use; one person's errands fit the free monthly amounts, and you can
  cap the daily use in Google's console so nothing is ever charged.

Your position goes only to your APX: one point at a time while a trip lasts, never a history.
