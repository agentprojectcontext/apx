---
category: Display
---
# ConnectSignal

The head of a connect or pair step: two marks joined by five dots, and the state in words under them. `from` is where
the link starts: APX for an account it signs in to, or a device's app that pairs with APX (the marks swap). The dots
move while `connecting`, turn green once `connected` and break with a red mark when `broken`; `idle` is quiet. Its CSS
is `@apx/ui/summary.css`, outside `styles.css` (only screens that load late use it).

```tsx
<ConnectSignal from={<img src={apxLogo} alt="" />} to={<IntegrationIcon id="stripe" name="Stripe" size={36} />} state="connecting" label="Connecting…" />
```
