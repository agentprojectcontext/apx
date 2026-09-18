---
name: apx-android
scope: optional
description: Install the APX Android app on the owner's phone over USB — "instalá la app en mi celular", "install the app on my phone", "pasame APX al teléfono", "apx android install", the APK, the download link, pairing a phone by cable. Load when asked to put APX on a phone, when an install fails, or when someone asks where to download the app.
---

# apx-android

APX is not on Google Play. The phone app ships as an APK, and there are exactly
two ways it reaches a phone:

| | |
|---|---|
| **Over USB, from here** | `apx android install` — you can run this |
| **From the phone itself** | `https://github.com/agentprojectcontext/apx/releases/download/android-latest/apx.apk` — the owner opens that link in the phone's browser |

## Before running anything, say what has to be true

`apx android install` needs the phone attached and USB debugging on. Neither is
something you can arrange, and a run that fails for a missing cable reads as a
broken command. So the first answer to "install it on my phone" is always the
two conditions, in the owner's own language, and then the command:

1. Plug the phone into this computer with a USB cable.
2. Turn USB debugging on: **Settings → About phone → tap Build number seven
   times**, then **Settings → System → Developer options → USB debugging**.
3. Unlock the phone and accept the **Allow USB debugging?** prompt when it appears.

Then run it. Do not run it first and report the failure afterwards.

## Running it

```bash
apx android install --yes
```

`--yes` skips the interactive confirmation, which no agent can answer — without
it the command refuses to run unattended and exits 1. That refusal is correct
behaviour, not a bug to work around any other way.

What the command does, in order: installs the APK, opens an `adb reverse` tunnel
so `127.0.0.1:7430` on the phone reaches this daemon, asks the daemon for a
pairing, and sends it to the app over the cable as a deep link the app submits
by itself. It prints the pairing code too, in case the phone asks for it.

`apx android status` reports what it can see before or after: adb, the attached
phone, the installed version, the tunnel.

## When it fails, the message says which of these it is

| What it says | What it means |
|---|---|
| `adb is not installed` | The USB tool is missing. Offer the install line for this platform, or the download link so the owner installs from the phone instead. |
| `no phone is attached` | Cable or debugging. Repeat the three conditions above. |
| `has not accepted this computer` | The phone is showing, or has dismissed, the RSA prompt. Ask the owner to unlock it and accept. |
| `A different APX is already installed, signed with another key` | A build from another source is on the phone. Replacing it means `adb uninstall dev.agentprojectcontext.apx`, which **deletes that phone's pairing** — say so and let the owner decide. |
| `could not download the APK` | No published release yet, or no network. A build in this checkout is used automatically when one exists. |

## The address the phone keeps

The USB tunnel dies when the cable is unplugged. A phone paired that way works
at home, attached, and nowhere else. When the owner wants it to keep working,
the answer is `apx panel tailscale on` and pairing against that HTTPS address
instead — it is also the only address a browser treats as secure, which is what
installing the panel as a web app and the microphone both depend on.

`apx panel share` is the middle option: a LAN address, fast, and gone the moment
the phone leaves the house.

## iPhone

There is no APK. The panel installs as a web app from the tailnet HTTPS address:
Safari → Share → Add to Home Screen. Do not offer `apx android install` for it.

## Do not

- Do not run `apx android install` without saying the conditions first.
- Do not uninstall an existing APX to get past a signature error without asking.
- Do not invent a Play Store link. There is none, and saying otherwise sends
  someone looking for something that does not exist.
