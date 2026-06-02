import * as vscode from 'vscode';
import { RecentItem } from './recentObjectsManager';

export interface ParsedItem {
    connection?: string;
    schema?: string;
    objectType?: string;
    objectName?: string;
    filename?: string;
}

/** Map file extensions to refined object sub-types (only when unambiguous). */
const EXT_TYPE_MAP: Record<string, string> = {
    '.pkb': 'PACKAGE BODY',
    '.pks': 'PACKAGE SPEC',
    '.tpb': 'TYPE BODY',
    '.tps': 'TYPE SPEC',
    '.trg': 'TRIGGER',
    '.prc': 'PROCEDURE',
    '.fnc': 'FUNCTION',
    '.sql': 'SQL',
};

/**
 * Object types that have SPEC/BODY variants.
 * When extension is ambiguous (e.g. .pls), nesting determines spec vs body:
 *   - Nested (extra folder)  → BODY
 *   - Non-nested (flat file) → SPEC
 */
const SPEC_BODY_TYPES = new Set(['PACKAGE', 'TYPE']);

export function parseDbToolsPath(uriString: string): ParsedItem {
    try {
        const uri = vscode.Uri.parse(uriString);
        const segments = uri.path.split('/').filter(Boolean);
        // Spec:  [conn, "object", SCHEMA, TYPE, OBJECT_NAME.ext]
        // Body:  [conn, "object", SCHEMA, TYPE, OBJECT_NAME, OBJECT_NAME.ext]
        const isNested = segments.length >= 6;
        const objectNameRaw = segments[4];
        const filename = isNested ? segments[5] : undefined;

        // Determine extension from the actual filename
        const leaf = filename ?? objectNameRaw ?? '';
        const ext = leaf.match(/(\.\w+)$/)?.[1]?.toLowerCase();

        // Start with the base type from the URI path
        const baseType = segments[3];
        let objectType = baseType;

        if (ext && EXT_TYPE_MAP[ext]) {
            // Extension unambiguously identifies the type
            objectType = EXT_TYPE_MAP[ext];
        } else if (baseType && SPEC_BODY_TYPES.has(baseType.toUpperCase())) {
            // For types with spec/body variants and ambiguous extension (.pls),
            // use nesting to determine
            objectType = isNested
                ? `${baseType.toUpperCase()} BODY`
                : `${baseType.toUpperCase()} SPEC`;
        }

        // Clean the object name: strip extension if it's the leaf (no sub-folder)
        let cleanName = objectNameRaw;
        if (cleanName && !isNested && ext) {
            cleanName = cleanName.replace(/\.\w+$/, '');
        }

        return {
            connection: segments[0],
            schema: segments[2],
            objectType,
            objectName: cleanName,
            filename,
        };
    } catch {
        return {};
    }
}

interface DisplayItem {
    label: string;
    connection: string;
    schema: string;
    objectType: string;
    uriString: string;
    timestamp: number;
}

function iconForType(objectType?: string): string {
    switch (objectType?.toUpperCase()) {
        case 'PACKAGE': case 'PACKAGE BODY': case 'PACKAGE SPEC': return 'codicon-package';
        case 'PROCEDURE': return 'codicon-symbol-method';
        case 'FUNCTION': return 'codicon-symbol-function';
        case 'TABLE': return 'codicon-table';
        case 'VIEW': return 'codicon-eye';
        case 'TRIGGER': return 'codicon-zap';
        case 'SEQUENCE': return 'codicon-list-ordered';
        case 'INDEX': return 'codicon-list-tree';
        case 'TYPE': case 'TYPE BODY': case 'TYPE SPEC': return 'codicon-symbol-class';
        default: return 'codicon-file-code';
    }
}

export class RecentObjectsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sqlDevCompanion.recentObjects';

    private _view?: vscode.WebviewView;
    private _items: ReadonlyArray<RecentItem> = [];
    private _onOpenItem = new vscode.EventEmitter<RecentItem>();
    readonly onOpenItem = this._onOpenItem.event;
    private _onRemoveItem = new vscode.EventEmitter<string>();
    readonly onRemoveItem = this._onRemoveItem.event;
    private _onClearHistory = new vscode.EventEmitter<void>();
    readonly onClearHistory = this._onClearHistory.event;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    refresh(items: ReadonlyArray<RecentItem>): void {
        this._items = items;
        if (this._view) {
            this._postUpdate();
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(msg => {
            switch (msg.type) {
                case 'open':
                    const item = this._items.find(i => i.uriString === msg.uriString);
                    if (item) { this._onOpenItem.fire(item); }
                    break;
                case 'remove':
                    this._onRemoveItem.fire(msg.uriString);
                    break;
                case 'clearHistory':
                    this._onClearHistory.fire();
                    break;
                case 'ready':
                    this._postUpdate();
                    break;
            }
        });
    }

    private _postUpdate(): void {
        if (!this._view) { return; }

        const items: DisplayItem[] = this._items.map(item => {
            const parsed = parseDbToolsPath(item.uriString);
            return {
                label: parsed.objectName ?? item.label,
                connection: parsed.connection ?? '',
                schema: parsed.schema ?? '',
                objectType: parsed.objectType ?? '',
                uriString: item.uriString,
                timestamp: item.timestamp,
            };
        });

        const connections = [...new Set(items.map(i => i.connection).filter(Boolean))].sort();
        const schemas = [...new Set(items.map(i => i.schema).filter(Boolean))].sort();
        const objectTypes = [...new Set(items.map(i => i.objectType).filter(Boolean))].sort();

        this._view.webview.postMessage({
            type: 'update',
            items,
            connections,
            schemas,
            objectTypes,
        });
    }

    private _getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .header {
            flex-shrink: 0;
        }

        .filters {
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
        }
        .filter-row {
            display: flex;
            gap: 4px;
        }

        /* --- Multi-select dropdown --- */
        .multi-select {
            position: relative;
            flex: 1;
            min-width: 0;
        }
        .multi-select-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            padding: 3px 6px;
            font-family: inherit;
            font-size: inherit;
            cursor: pointer;
            outline: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .multi-select-toggle:focus,
        .multi-select.open .multi-select-toggle {
            border-color: var(--vscode-focusBorder);
        }
        .multi-select-toggle .arrow {
            margin-left: 4px;
            flex-shrink: 0;
            font-size: 10px;
            opacity: 0.7;
        }
        .multi-select-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: 100;
            background: var(--vscode-dropdown-background, var(--vscode-input-background));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-focusBorder));
            border-radius: 2px;
            max-height: 180px;
            overflow-y: auto;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .multi-select.open .multi-select-dropdown {
            display: block;
        }
        .multi-select-option {
            display: flex;
            align-items: center;
            padding: 3px 8px;
            cursor: pointer;
            gap: 6px;
            font-size: inherit;
        }
        .multi-select-option:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .multi-select-option input[type="checkbox"] {
            accent-color: var(--vscode-focusBorder);
            cursor: pointer;
        }
        .multi-select-option label {
            cursor: pointer;
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        input[type="text"] {
            flex: 1;
            min-width: 0;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            padding: 3px 6px;
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }
        input[type="text"]:focus {
            border-color: var(--vscode-focusBorder);
        }

        .toolbar {
            display: flex;
            justify-content: flex-end;
            padding: 2px 8px;
        }
        .toolbar button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 2px 6px;
            font-size: 12px;
            opacity: 0.7;
        }
        .toolbar button:hover {
            opacity: 1;
            color: var(--vscode-textLink-foreground);
        }

        .items { overflow-y: auto; flex: 1; min-height: 0; }

        .item {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            cursor: pointer;
            gap: 6px;
        }
        .item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .item-icon {
            flex-shrink: 0;
            font-size: 16px;
            width: 16px;
            text-align: center;
        }
        .item-content {
            flex: 1;
            min-width: 0;
            overflow: hidden;
        }
        .item-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .item-detail {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 11px;
            opacity: 0.7;
        }
        .item-remove {
            flex-shrink: 0;
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 2px 4px;
            opacity: 0.3;
            font-size: 14px;
            line-height: 1;
        }
        .item:hover .item-remove { opacity: 0.6; }
        .item-remove:hover { opacity: 1 !important; }

        .item-time {
            flex-shrink: 0;
            font-size: 10px;
            opacity: 0.5;
            white-space: nowrap;
            margin-left: auto;
            padding: 0 4px;
            align-self: flex-start;
            margin-top: 2px;
        }

        .empty {
            padding: 16px;
            text-align: center;
            opacity: 0.6;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="filters">
            <div class="filter-row">
                <div class="multi-select" id="msConnection" data-placeholder="All Connections"></div>
            </div>
            <div class="filter-row">
                <div class="multi-select" id="msSchema" data-placeholder="All Schemas"></div>
                <div class="multi-select" id="msObjectType" data-placeholder="All Types"></div>
            </div>
            <div class="filter-row">
                <input type="text" id="filterText" placeholder="Filter by name..." title="Filter by object name" />
            </div>
        </div>
        <div class="toolbar">
            <button id="btnClearHistory" title="Clear all history">Clear History</button>
        </div>
    </div>
    <div class="items" id="itemsContainer"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const filterText = document.getElementById('filterText');
        const itemsContainer = document.getElementById('itemsContainer');
        const btnClearHistory = document.getElementById('btnClearHistory');

        let allItems = [];

        const iconMap = ${JSON.stringify(Object.fromEntries([
            ['PACKAGE', 'codicon-package'], ['PACKAGE BODY', 'codicon-package'],
            ['PACKAGE SPEC', 'codicon-package'],
            ['PROCEDURE', 'codicon-symbol-method'], ['FUNCTION', 'codicon-symbol-function'],
            ['TABLE', 'codicon-table'], ['VIEW', 'codicon-eye'],
            ['TRIGGER', 'codicon-zap'], ['SEQUENCE', 'codicon-list-ordered'],
            ['INDEX', 'codicon-list-tree'], ['TYPE', 'codicon-symbol-class'],
            ['TYPE BODY', 'codicon-symbol-class'], ['TYPE SPEC', 'codicon-symbol-class'],
        ]))};

        function getIcon(type) {
            return iconMap[(type || '').toUpperCase()] || 'codicon-file-code';
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }

        function formatTime(ts) {
            const d = new Date(ts);
            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return diffMins + 'm ago';
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return diffHours + 'h ago';
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7) return diffDays + 'd ago';
            return d.toLocaleDateString();
        }

        /* ---- Multi-select dropdown component ---- */
        class MultiSelect {
            constructor(container, onChange) {
                this.container = container;
                this.placeholder = container.dataset.placeholder || 'All';
                this.selected = new Set();
                this.values = [];
                this.onChange = onChange;

                this.toggle = document.createElement('button');
                this.toggle.className = 'multi-select-toggle';
                this.toggle.type = 'button';
                this.toggle.innerHTML = this.placeholder + ' <span class="arrow">▾</span>';

                this.dropdown = document.createElement('div');
                this.dropdown.className = 'multi-select-dropdown';

                container.appendChild(this.toggle);
                container.appendChild(this.dropdown);

                this.toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Close other open dropdowns
                    document.querySelectorAll('.multi-select.open').forEach(el => {
                        if (el !== container) el.classList.remove('open');
                    });
                    container.classList.toggle('open');
                });
            }

            setValues(values) {
                this.values = values;
                // Remove selections that no longer exist
                for (const s of [...this.selected]) {
                    if (!values.includes(s)) this.selected.delete(s);
                }
                this._buildDropdown();
                this._updateLabel();
            }

            getSelected() {
                return this.selected;
            }

            _buildDropdown() {
                this.dropdown.innerHTML = '';
                for (const v of this.values) {
                    const opt = document.createElement('div');
                    opt.className = 'multi-select-option';

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = this.selected.has(v);
                    cb.id = 'ms-' + this.container.id + '-' + v;

                    const lbl = document.createElement('label');
                    lbl.textContent = v;
                    lbl.setAttribute('for', cb.id);

                    opt.appendChild(cb);
                    opt.appendChild(lbl);

                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (this.selected.has(v)) {
                            this.selected.delete(v);
                            cb.checked = false;
                        } else {
                            this.selected.add(v);
                            cb.checked = true;
                        }
                        this._updateLabel();
                        this.onChange();
                    });

                    this.dropdown.appendChild(opt);
                }
            }

            _updateLabel() {
                const sel = [...this.selected];
                let text;
                if (sel.length === 0) {
                    text = this.placeholder;
                } else if (sel.length <= 2) {
                    text = sel.join(', ');
                } else {
                    text = sel.length + ' selected';
                }
                this.toggle.innerHTML = escapeHtml(text) + ' <span class="arrow">▾</span>';
            }
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            document.querySelectorAll('.multi-select.open').forEach(el => el.classList.remove('open'));
        });

        const msConnection = new MultiSelect(document.getElementById('msConnection'), render);
        const msSchema = new MultiSelect(document.getElementById('msSchema'), render);
        const msObjectType = new MultiSelect(document.getElementById('msObjectType'), render);

        /* ---- Guard against double-click opening wrong item after reorder ---- */
        let lastOpenTime = 0;
        let lastOpenX = 0;
        let lastOpenY = 0;
        const OPEN_DEBOUNCE_MS = 400;
        const OPEN_DEBOUNCE_PX = 5;
        function tryOpen(uriString, e) {
            const now = Date.now();
            const dx = e.clientX - lastOpenX;
            const dy = e.clientY - lastOpenY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (now - lastOpenTime < OPEN_DEBOUNCE_MS && dist < OPEN_DEBOUNCE_PX) return;
            lastOpenTime = now;
            lastOpenX = e.clientX;
            lastOpenY = e.clientY;
            vscode.postMessage({ type: 'open', uriString });
        }

        /* ---- Render list ---- */
        function render() {
            const connSel = msConnection.getSelected();
            const schemaSel = msSchema.getSelected();
            const typeSel = msObjectType.getSelected();
            const textF = filterText.value.toLowerCase();

            const filtered = allItems.filter(item => {
                if (connSel.size > 0 && !connSel.has(item.connection)) return false;
                if (schemaSel.size > 0 && !schemaSel.has(item.schema)) return false;
                if (typeSel.size > 0 && !typeSel.has(item.objectType)) return false;
                if (textF && !item.label.toLowerCase().includes(textF)) return false;
                return true;
            });

            if (filtered.length === 0) {
                itemsContainer.innerHTML = '<div class="empty">No matching objects</div>';
                return;
            }

            itemsContainer.innerHTML = '';
            for (const item of filtered) {
                const row = document.createElement('div');
                row.className = 'item';
                row.title = item.uriString;

                row.innerHTML =
                    '<span class="item-icon codicon ' + getIcon(item.objectType) + '"></span>' +
                    '<div class="item-content">' +
                        '<div class="item-label">' + escapeHtml(item.label) + '</div>' +
                        '<div class="item-detail">' + escapeHtml(item.connection) + ' \\u00B7 ' + escapeHtml(item.schema) + ' \\u00B7 ' + escapeHtml(item.objectType) + '</div>' +
                    '</div>' +                    '<span class="item-time">' + escapeHtml(formatTime(item.timestamp)) + '</span>' +
                    '<button class="item-remove" title="Remove">\u00D7</button>';

                row.querySelector('.item-content').addEventListener('click', (e) => {
                    tryOpen(item.uriString, e);
                });

                row.querySelector('.item-remove').addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ type: 'remove', uriString: item.uriString });
                });

                itemsContainer.appendChild(row);
            }
        }

        filterText.addEventListener('input', render);
        btnClearHistory.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearHistory' });
        });

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'update') {
                allItems = msg.items;
                msConnection.setValues(msg.connections);
                msSchema.setValues(msg.schemas);
                msObjectType.setValues(msg.objectTypes);
                render();
            }
        });

        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
