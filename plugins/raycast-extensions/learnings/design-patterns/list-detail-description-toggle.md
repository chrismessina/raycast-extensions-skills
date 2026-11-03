---
title: "List detail pane: a Show/Hide Description toggle (⇧⌘Y) so the markdown can have the whole pane"
date: 2026-11-02
category: design-patterns
module: list-detail
component: list-item-detail
problem_type: design_pattern
severity: low
applies_when:
  - "A List with isShowingDetail renders both `markdown` and `metadata` in List.Item.Detail"
  - "The metadata table is tall enough to push the markdown body into a small scroll area"
---

# List detail pane: Show/Hide Description toggle

`List.Item.Detail` splits its pane between `markdown` (top) and `metadata` (bottom). When the
metadata table has five or six rows, the markdown shrinks to a few lines and fades out under it.
The fix is a persisted view toggle, next to Toggle Sidebar, that drops the metadata.

## Pattern

Reference implementation: `raycast-cosign/src/components/view-actions.tsx` (`useDescriptionOnly`,
`ViewSection`), used by the search lists, Funding and Open Roles views. Chris confirmed the behavior on 2026-11-02.

```tsx
const [descriptionOnly, setDescriptionOnly] = useCachedState("description-only", false);

<List.Item.Detail
  markdown={body?.markdown}
  metadata={body && !descriptionOnly ? <Metadata … /> : undefined}
/>

<ActionPanel.Section title="View">
  {/* Toggle Sidebar ⇧⌘D sits here too */}
  <Action
    title={descriptionOnly ? "Hide Description" : "Show Description"}
    icon={Icon.AlignLeft}
    shortcut={{ macOS: { modifiers: ["cmd", "shift"], key: "y" }, Windows: { modifiers: ["ctrl", "shift"], key: "y" } }}
    onAction={() => setDescriptionOnly((v) => !v)}
  />
</ActionPanel.Section>
```

- **Shortcut:** ⇧⌘Y, the same one brew uses (`brew/src/search.tsx`). It is not in the
  `Keyboard.Shortcut.Common` table, so there is no collision to check against it.
- **Persist** with `useCachedState`, so the choice survives relaunch.
- **Label:** the title flips with state, as brew's does.

## Group both toggles under a "View" section

Put Toggle Sidebar (⇧⌘D) and Show/Hide Description (⇧⌘Y) together in one
`<ActionPanel.Section title="View">`, as brew does. Detail views that have no sidebar toggle (always-on
detail) still get the section, with only the description action. Share the state with one
`useCachedState("description-only")` key so the choice applies to every list in the extension.

## Not the same polarity as brew

Brew defaults `show-description` to `true` and the action hides the description. Here the default
is the full detail (markdown plus metadata) and the action means "description only." Pick the polarity per
extension, but keep the label honest about what the next press does.

## Gotcha

Passing `metadata={undefined}` is how the table goes away; do not render an empty
`List.Item.Detail.Metadata`, which leaves a blank band.
