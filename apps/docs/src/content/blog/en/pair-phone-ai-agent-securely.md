---
title: "How to reach your AI agent from your phone safely"
description: "Pair a phone, check connectivity and know what access can be revoked."
lang: en
slug: pair-phone-ai-agent-securely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/pair-phone-ai-agent-securely/hero.webp
  alt: "A phone connected securely to a desktop computer."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/devices/phone/"
    checked: "2026-11-08"
---

Being away from your desk should not require forwarding every task to yourself. But a phone app and the computer running an agent are different parts of the system: the phone needs a reachable installation, and losing the phone should not mean giving up control of every other device.

## Check which computer is doing the work

Before pairing, make sure your APX installation is running and reachable from the phone on a network you trust. A phone cannot connect to an installation that only listens on the computer itself. Pairing does not keep a powered-off computer running or guarantee that a suspended phone can provide a camera or location.

## Pair a single device

The [phone guide](https://apxagent.app/docs/devices/phone/) describes opening the pairing QR from the panel or pairing a mobile browser. The code is short-lived and single-use. Treat it like an access invitation: scan only a code you generated for your own installation and do not post it in a public chat.

A paired device gets its own key rather than the core’s main token. APX lists paired devices so you can remove one without disconnecting all the others. If a phone is lost, revoke its entry and follow your organization’s device-security process.

## Test an ordinary request

1. Open a conversation on the phone and ask for a harmless status check.
2. Confirm the reply belongs to the expected project and installation.
3. Test notifications separately; a paired phone may also need notification permission and a working push registration.
4. Review any permission request before letting an agent use location or take a photo.

The Android app can lend location and a camera while connected, but pairing is not general access to every phone app or file. A photo is taken by you. Check the guide for current platform availability and features.
