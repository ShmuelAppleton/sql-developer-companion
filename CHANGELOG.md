# Changelog

## 1.1.2 — 2026-06-02

- Added `recentObjectsOpenAsPreview` setting to control whether recent objects open in preview mode or as pinned editors (default: pinned).
- Fixed double-click in the Recent Objects panel accidentally opening a different item after list reorder.
- Changed default for `highlightExecutedStatement` to `false` (disabled by default).

## 1.1.1 — 2026-05-05

- Added configurable highlight styles for executed statements (subtle, moderate, bold, border-only, custom).
- Default changed from harsh orange to a softer blue highlight.

## 1.1.0 — 2026-04-30

- Added PL/SQL Navigation: intra-package and local-file Go to Definition (Ctrl+Click), complementing Oracle's database-only navigation.
- Supported symbols: cursors, procedures, functions, variables, parameters, types, tables, and packages.
- Added cross-file workspace indexing for `.pks`, `.pkb`, `.sql`, `.pls`, `.plb`, `.pck` files.
- Added hover tooltips showing signatures and code snippets.
- Added package-aware navigation for qualified references (body/spec/both via setting).
- Added "Go to Local Definition" command (Alt+F12) and context menu entry.
- Added Statement Highlighter: highlights executed SQL in the editor.
- Added Connection Colors: tab badges and Peacock-style workspace coloring per connection.
- Added right-click context menu on connections to set badges and workspace colors.

## 1.0.0 — 2026-04-26

- Initial public release.
- Automatic tracking of recently viewed Oracle database objects.
- Sidebar "Recent Objects" panel in the SQL Developer explorer.
- Multi-select filters for connection, schema, and object type.
- Free-text name filtering.
- One-click reopen with automatic connection re-establishment.
- Remove individual items or clear full history.
- Command palette integration.
