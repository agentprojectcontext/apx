---
category: Identity
---
# AgentAvatar

The one avatar for agents: APX's silicone **blobs** with SVG eyes that look around and blink (desynced per name). This is APX identity — use it for every agent, in both looks.

- `blob`: any key of `BLOB_NAMES` — menta, parche, trino, cubi, nimbo, papa, noche, kiwi, gajo, campana, cobalto, rubi, trebol, saturno, onyx, perla, faro, brasa, aqua, coral, zafiro, pino, eclipse, peon, ovni, amatista, volcan, quad, cometa, lila, orbita, caracol, iris, laguna, carbon.
- `animated={false}` in dense lists/pickers; motion stops under prefers-reduced-motion.
- Unknown blob → initials Avatar.

```tsx
<AgentAvatar name="Roby" blob="noche" size={40} status="online" />
```
