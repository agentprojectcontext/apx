---
category: Forms
---
# SuggestTextarea

A Textarea that offers what can be written when the word being typed starts with a trigger (`$` or `{` by default):
variables in a shell command, slots in a prompt. Arrows choose, Enter or Tab writes it, Escape closes the list.

```tsx
<SuggestTextarea value={post} onValueChange={setPost} rows={2}
  suggestions={[{ insert: "$APX_LLM_OUTPUT", hint: "what the agent answered" }]} />
```
