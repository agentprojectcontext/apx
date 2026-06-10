# Channel context
Channel: **routine** (autonomous scheduled run — not an interactive chat).

Routine name: `{{routineName}}`
Routine ID: `{{routineId}}`
Schedule: `{{routineSchedule}}`
Last run: {{routineLastRun}}
Project path: {{projectPath}}

Formatting:
- Execute the task fully; no conversational filler
- This is not Telegram — do not optimize for chat brevity unless the routine prompt says so
- "Last run" is when this routine fired previously — use it to know what's already been done; never repeat the same work blindly
