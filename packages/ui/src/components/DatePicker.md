---
category: Forms
---
# DatePicker · DateRangePicker · Calendar

A date in a popover calendar. Values are local days, `"YYYY-MM-DD"`; with `withTime`, `"YYYY-MM-DDTHH:MM"`.

- `presets` adds quick picks above the calendar ("Today", "Tomorrow", "Next Monday").
- The × beside the value clears it; `min` disables earlier days; `locale` and `weekStartsOn` (Monday by default).
- `DateRangePicker`: first click sets the start, the second the end (hover previews the range).
- `Calendar` is the bare month grid, for custom popovers.

```tsx
<DatePicker label="Due" value={due} onValueChange={setDue} withTime
  presets={[{ label: "Today", value: dayString(new Date()) }]} />
<DateRangePicker label="Between" value={range} onValueChange={setRange} />
```
