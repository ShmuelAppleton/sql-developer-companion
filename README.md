# SQL Developer Companion

A companion extension for [Oracle SQL Developer for VS Code](https://marketplace.visualstudio.com/items?itemName=Oracle.sql-developer) that adds quality-of-life features.

## Features

### Recent Objects Panel

Track and quickly reopen recently viewed database objects directly from the SQL Developer sidebar.

- **Automatic tracking** — every database object you open (tables, packages, procedures, views, etc.) is remembered automatically.
- **Sidebar panel** — a "Recent Objects" view appears inside the SQL Developer explorer, showing your history with icons for each object type.
- **Filter & search** — filter by connection, schema, object type, or free-text search by name.
- **One-click reopen** — click any item to reopen it, with automatic connection re-establishment when needed.
- **Remove individual items** or clear the full history.
- **Command palette** — use **SQL Developer Companion: Reopen Recent Oracle Object** from the command palette for a Quick Pick list.

### PL/SQL Navigation

Oracle SQL Developer provides Go to Definition for database-stored objects, but it doesn't work for symbols defined within the same package or across local PL/SQL files in your workspace. This feature fills that gap.

- **Intra-package navigation** — Ctrl+Click on a cursor, variable, procedure, or function reference within a package to jump to its definition in the same file — something Oracle's built-in navigation doesn't support.
- **Local file navigation** — if you maintain a repository of PL/SQL source files (`.pks`, `.pkb`, `.sql`, `.pls`, `.plb`, `.pck`), the extension indexes them and provides cross-file Go to Definition across your workspace.
- **Hover tooltips** — hover over any identifier to see its signature, cursor SQL, or variable type without leaving your current position.
- **Package-aware** — navigate qualified references like `PKG_NAME.PROCEDURE` to the correct package body or spec, configurable via settings.
- **Go to Local (Alt+F12)** — jump directly to a definition within the current file, skipping the VS Code picker.
- **Context menu** — right-click to access "Go to Local Definition" in Oracle SQL files.
- **Supported symbols** — cursors, procedures, functions, variables, parameters, types, tables, and packages.

### Statement Highlighter

Highlights the executed SQL statement in the editor when query results are displayed.

- **Automatic highlighting** — when you run a statement in a worksheet, the executed code is highlighted in the editor.

### Connection Colors

Color-code your workspace based on which Oracle connection is active — never accidentally run queries on the wrong database.

- **Tab badges** — right-click a connection in the SQL Developer sidebar to assign an emoji badge (e.g., 🔴 for production, 🟢 for dev). Badges appear on worksheet tabs.
- **Workspace coloring** — assign colors to connections that automatically apply to the title bar, activity bar, and status bar when a worksheet for that connection is active. Requires a VS Code workspace to be open.
- **Status bar styles** — choose between full background coloring or a subtle top border.

## Requirements

- [Oracle SQL Developer for VS Code](https://marketplace.visualstudio.com/items?itemName=Oracle.sql-developer) must be installed and activated.
- **Connection Colors** requires SQL Developer logging to be set to TRACE level (the extension will prompt to configure this).

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sqlDevCompanion.maxRecentItems` | `50` | Maximum number of recent objects to remember |
| `sqlDevCompanion.uriSchemes` | `[]` | URI schemes to track (leave empty to auto-detect Oracle schemes) |
| `sqlDevCompanion.recentObjectsOpenAsPreview` | `false` | Open recent objects in preview mode (italic tab, replaced on next open) |
| `sqlDevCompanion.packageDefinitionTarget` | `"body"` | Navigate to package body, spec, or both |
| `sqlDevCompanion.highlightExecutedStatement` | `false` | Highlight executed SQL statement in the editor |
| `sqlDevCompanion.highlightStyle` | `"subtle"` | Highlight style: `"subtle"`, `"moderate"`, `"bold"`, `"border-only"`, or `"custom"` |
| `sqlDevCompanion.highlightCustomBackground` | `"rgba(100, 150, 255, 0.15)"` | Custom background color (when style is `"custom"`) |
| `sqlDevCompanion.highlightCustomBorder` | `"rgba(100, 150, 255, 0.5)"` | Custom border color (when style is `"custom"`) |
| `sqlDevCompanion.colorTitleBar` | `true` | Apply connection colors to the title bar |
| `sqlDevCompanion.colorActivityBar` | `true` | Apply connection colors to the activity bar |
| `sqlDevCompanion.colorStatusBar` | `true` | Apply connection colors to the status bar |
| `sqlDevCompanion.statusBarStyle` | `"background"` | Status bar color style: `"background"` or `"border"` |
| `sqlDevCompanion.connectionRules` | `[]` | Connection-to-badge/color mappings (set via right-click menu) |

## License

[MIT](LICENSE) — Copyright (c) 2026 Weizmann Institute of Science
