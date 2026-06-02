import * as vscode from 'vscode';

export interface RecentItem {
    /** Display label (e.g. filename or object name) */
    label: string;
    /** Full URI string for reopening */
    uriString: string;
    /** URI scheme (e.g. "oracle", "dbdev") */
    scheme: string;
    /** Epoch ms when last opened */
    timestamp: number;
}

const STORAGE_KEY = 'sqlDevCompanion.recentItems';

/** Schemes tracked by default when no explicit list is configured. */
const DEFAULT_TRACKED_SCHEMES = new Set(['dbtools']);

export class RecentObjectsManager {
    private items: RecentItem[] = [];
    private readonly state: vscode.Memento;
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.state = context.globalState;
        this.items = this.state.get<RecentItem[]>(STORAGE_KEY, []);
    }

    /** Track a document if it belongs to a relevant (non-built-in) scheme. */
    trackDocument(doc: vscode.TextDocument): void {
        this.trackUri(doc.uri, this.deriveLabel(doc.uri, doc));
    }

    /** Track a URI directly (for custom editors / webview tabs). */
    trackUri(uri: vscode.Uri, label?: string): void {
        const scheme = uri.scheme;

        const configuredSchemes: string[] =
            vscode.workspace.getConfiguration('sqlDevCompanion').get('uriSchemes', []);

        const shouldTrack = configuredSchemes.length > 0
            ? configuredSchemes.includes(scheme)
            : DEFAULT_TRACKED_SCHEMES.has(scheme);

        if (!shouldTrack) {
            return;
        }

        const uriString = uri.toString();
        const resolvedLabel = label ?? this.deriveLabelFromUri(uri);

        this.items = this.items.filter(item => item.uriString !== uriString);

        this.items.unshift({
            label: resolvedLabel,
            uriString,
            scheme,
            timestamp: Date.now(),
        });

        const maxItems: number =
            vscode.workspace.getConfiguration('sqlDevCompanion').get('maxRecentItems', 50);
        if (this.items.length > maxItems) {
            this.items = this.items.slice(0, maxItems);
        }

        this.persist();
    }

    /** Get the list of recent items, most recent first. */
    getRecentItems(): ReadonlyArray<RecentItem> {
        return this.items;
    }

    /** Clear all stored history. */
    clearHistory(): void {
        this.items = [];
        this.persist();
    }

    /** Remove a single item by URI string. */
    removeItem(uriString: string): void {
        this.items = this.items.filter(item => item.uriString !== uriString);
        this.persist();
    }

    private persist(): void {
        this.state.update(STORAGE_KEY, this.items);
        this._onDidChange.fire();
    }

    /** Derive a human-readable label from just the URI. */
    private deriveLabelFromUri(uri: vscode.Uri): string {
        const path = uri.path;
        if (path) {
            const segments = path.split('/').filter(Boolean);
            if (segments.length > 0) {
                return segments[segments.length - 1];
            }
        }
        return uri.toString();
    }

    /** Derive a human-readable label from the URI and document. */
    private deriveLabel(uri: vscode.Uri, doc: vscode.TextDocument): string {
        const fromUri = this.deriveLabelFromUri(uri);
        if (fromUri !== uri.toString()) {
            return fromUri;
        }
        // Fallback: use the language ID or raw URI
        if (doc.languageId && doc.languageId !== 'plaintext') {
            return `${doc.languageId} document`;
        }
        return uri.toString();
    }
}
