# Bound extension credentials

A manifest 2 sensitive string setting can declare `boundTo: ["address", "username"]`. Each name must identify a declared plain setting. Generated secrets cannot use this option.

APX validates the entire settings request before writing any value. When an existing credential has a different binding, an incompatible legacy format, or missing binding metadata, the request must include a different nonempty credential. Whitespace-only regrouping does not count as replacement. A failed request leaves the prior settings and credential unchanged. Unchanged bindings preserve an omitted credential.

The secret store holds a JSON envelope, not the plain password:

```json
{"format":"apx-bound-secret@1","binding":{"address":"https://shop.example/store","username":"reader"},"value":"replacement application password"}
```

The extension receives this envelope through its declared `secret://` environment reference. Its bridge must validate the format and every bound value against its current plain settings before extracting the value or making any network request. Do not put the envelope or its value in arguments, logs or errors. Plain settings are inserted after secret resolution and are never interpreted recursively as templates.

Bindings compare complete checked setting values, including an address's installation path. They are intentionally stricter than origin equality; even a spelling change can require replacement. The bridge must additionally validate HTTPS and refuse redirects. Credential revocation remains the owner's action in the original service; a new password in APX does not revoke the old one remotely.

This validates one settings operation before applying it. The external secret backend and SQLite are separate stores, not a crash-atomic distributed transaction. Consumer-side binding checks must remain in place as the final fail-closed boundary.

An older APX does not understand `boundTo`. Private packages using it require a build containing this contract and must set their release minimum before publication. A bridge must not fall back to a legacy plain credential or old environment variable.

Regression coverage: `apps/core/src/extensions/bound-settings.test.ts`, `apps/core/src/mcp/literal-settings.test.ts`.
