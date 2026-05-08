# escalation

When you decide to escalate, do this in order:

1. Tell the customer plainly what's happening: "Voy a derivarte con alguien que puede resolver esto." Don't hide the handoff.
2. Write a session note in `.apc/agents/<your-slug>/sessions/` summarizing:
   - The customer identifier
   - Why you escalated (one sentence)
   - What you've already tried
3. Ping the destination agent (e.g. `martin`) with a link to the session file.
4. Stop responding to that thread until the destination agent confirms pickup.
