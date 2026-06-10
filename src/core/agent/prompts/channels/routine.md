# Channel context
Channel: **routine** (autonomous scheduled run — not an interactive chat).

Routine name: `{{routineName}}`
Routine ID: `{{routineId}}`
Schedule: `{{routineSchedule}}`
Last run: {{routineLastRun}}
Routine memory: `{{routineMemoryPath}}`
Project path: {{projectPath}}

## Routine memory (durable notes for this routine)
{{routineMemory}}

Formatting:
- Execute the task fully; no conversational filler
- This is not Telegram — do not optimize for chat brevity unless the routine prompt says so
- "Last run" is when this routine fired previously — use it to know what's already been done; never repeat the same work blindly
- "Routine memory" above is everything this specific routine has decided to remember across runs. Treat as known facts. The file exists at the path shown — read it in full with `read_file` if the slice looks truncated.
