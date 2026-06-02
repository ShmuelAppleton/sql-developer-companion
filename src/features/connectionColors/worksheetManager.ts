import * as vscode from 'vscode';
import type { Api, Worksheet } from '@oracle/sql-developer-api';
import type { TabDecorationProvider } from './tabDecorationProvider';

/**
 * Manages worksheet lifecycle events.
 * 
 * Note: Connection tracking is handled by SessionTracker which watches the SQL Developer logs.
 * This class handles refreshing decorations on worksheet changes.
 */
export class WorksheetManager {
    private api: Api;
    private decorationProvider: TabDecorationProvider;

    constructor(api: Api, decorationProvider: TabDecorationProvider) {
        this.api = api;
        this.decorationProvider = decorationProvider;
    }

    /**
     * Register event handlers for worksheet lifecycle
     */
    registerEventHandlers(context: vscode.ExtensionContext): void {
        const worksheetsApi = this.api.worksheets();

        // When a worksheet closes, refresh all decorations
        context.subscriptions.push(
            worksheetsApi.onDidCloseWorksheet(() => {
                this.decorationProvider.refreshAll();
            })
        );
    }

    /**
     * Find worksheet by URI
     */
    findWorksheetByUri(uri: string): Worksheet | undefined {
        const visibleWorksheets = this.api.worksheets().visibleWorksheets;
        return visibleWorksheets.find(ws => ws.editor.document.uri.toString() === uri);
    }

    /**
     * Refresh decorations for all visible worksheets
     */
    refreshAllWorksheets(): void {
        this.decorationProvider.refreshAll();
    }
}
