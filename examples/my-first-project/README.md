# my-first-project

Example APC project used as a reference fixture.

This directory shows the current repository layout:

- root `AGENTS.md`
- project context under `.apc/`
- per-agent memory files
- example sessions and skills

## What's here

```text
.
├── AGENTS.md
├── .apc/
│   ├── project.json
│   ├── agents/
│   │   ├── sofia/
│   │   │   ├── memory.md
│   │   │   └── sessions/
│   │   │       └── 2026-05-07-onboarding.md
│   │   └── martin/
│   │       └── memory.md
│   ├── skills/
│   │   ├── customer-support.md
│   │   ├── escalation.md
│   │   ├── pricing.md
│   │   └── sales-funnel.md
│   └── mcps.json
└── README.md
```

## Notes

- This example reflects the current implementation in this repository.
- Some current runtime artifacts, such as `project.db` or message logs, are consumer-specific extensions rather than APC portable-core requirements.
- The broader APC docs live in the repository root under [README](../../README.md) and [`docs/`](../../docs/).
