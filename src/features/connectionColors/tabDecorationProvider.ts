import * as vscode from 'vscode';
import type { ConnectionRule } from './types';
import { SessionTracker } from './sessionTracker';

/**
 * Provides file decorations (badges) for editor tabs.
 * Queries SessionTracker for connection info - SessionTracker is the single source of truth.
 */
export class TabDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    
    private sessionTracker: SessionTracker | undefined;

    /**
     * Set the session tracker to query for connections
     */
    setSessionTracker(tracker: SessionTracker): void {
        this.sessionTracker = tracker;
    }

    /**
     * Fire decoration change for a specific log URI (find all matching documents)
     */
    fireChangeForLogUri(logUri: string): void {
        const matchingUris: vscode.Uri[] = [];
        for (const doc of vscode.workspace.textDocuments) {
            if (SessionTracker.toLogUri(doc.uri) === logUri) {
                matchingUris.push(doc.uri);
            }
        }
        if (matchingUris.length > 0) {
            this._onDidChangeFileDecorations.fire(matchingUris);
        }
    }

    /**
     * Trigger decoration update for all open documents
     */
    refreshAll(): void {
        const uris = vscode.workspace.textDocuments.map(d => d.uri);
        if (uris.length > 0) {
            this._onDidChangeFileDecorations.fire(uris);
        }
    }

    /**
     * Provide file decoration for a given URI
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (!this.sessionTracker) {
            return undefined;
        }

        // Get connection from the single source of truth
        const connectionName = this.sessionTracker.getConnectionForDocument(uri);
        if (!connectionName) {
            return undefined;
        }

        // Find matching rule for badge
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const rules = config.get<ConnectionRule[]>('connectionRules', []);
        const rule = rules.find(r => r.connectionName === connectionName);
        
        if (rule?.badge) {
            return { badge: rule.badge, tooltip: connectionName };
        }

        return { tooltip: connectionName };
    }
}
