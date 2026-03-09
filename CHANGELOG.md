# Changelog

## v1.0.0 - 2026-03-09

### Initial Release

- Slash commands: `/move`, `/move to page`, `/move to today`, `/move to journal`
- Keyboard shortcut: `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux)
- Block context menu: "Move to..."
- Searchable page picker modal with keyboard navigation
- Recursive child block movement (full tree moves together)
- Parallel child processing for faster moves on large trees
- Auto-collapse moved blocks with children at destination
- Property preservation on moved blocks
- "Moving..." progress indicator for large moves
- Recent destinations tracking (session-local)
- Configurable move position (top or bottom of page)
- Navigate to destination page option
- Confirmation toast after successful move
- DB version only (uses `:block/title` and DB-native APIs)
