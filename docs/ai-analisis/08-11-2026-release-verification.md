# Release verification failure assessment

## Current behavior and evidence

The `verify` run for main commit `b4b802efd` failed after static checks passed. Linux and Windows unit jobs report a failure in `apps/core/src/news/news-telegram.test.ts`: the notification button's request is expected in Home. The same assertion was reproduced locally. Channel routing now keeps the owner's conversation in the channel account thread, so the test's Home lookup conflicts with the current routing contract. A fix must still verify that the request is recorded as the owner in the correct account chat and that the response is delivered once.

Panel coverage jobs fail their shared Playwright setup: `e2e/specs/10-whatsapp.spec.ts` reports failures in owner linking, stranger handling and media recovery. Later panel tests do not run because setup failed. The first scenario explicitly assumes that WhatsApp and Telegram owner messages live in Home, while channel routing now uses account chats. The available log also reports a timeout in the media recovery scenario; its cause is not yet established. Coverage totals from these aborted jobs do not establish a genuine coverage regression.

The coverage report and final verify job fail after their prerequisites. A failed macOS unit job and the unit coverage job need their full failure details checked independently before asserting they share a cause.

## Recommended design and affected areas

Update the Telegram news test to locate the owner's account conversation and retain the existing identity and message assertions. Investigate the WhatsApp setup failures individually; adapt obsolete Home assumptions to the account-chat contract while retaining coverage for cross-account isolation, admission, replies and media recovery. Fix actual behavior where evidence shows a product regression; do not merely increase timeouts or remove assertions.

## Constraints, risk and verification plan

Keep the running owner core and its data untouched. Use a task branch and isolated test state. Reproduce the Telegram test, then run the targeted test after correction. Reproduce the WhatsApp setup in an isolated Playwright core, inspect the original and retry failures, and run only the affected scenarios locally before CI. Check the other failed jobs' logs. GitHub's exact-main verification must pass before any release tag is made.

No product or test fix has been implemented in this assessment. Product compatibility, macOS and complete CI success remain UNVERIFIED. No owner decision is required to diagnose; implementation and eventual integration should preserve the existing account-specific behavior.

Docs impact: this investigation records CI failures and the verification plan; reassess user documentation if a product behavior changes.
