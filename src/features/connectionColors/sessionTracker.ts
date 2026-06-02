import * as vscode from 'vscode';
import { LogWatcher, WorksheetAction } from './logWatcher';

// Callback type: logUri changed, optional connectionName (undefined = detached)
export type SessionChangeCallback = (logUri: string, connectionName: string | undefined) => void;

/**
 * Tracks worksheet session state by watching the Oracle SQL Developer log file.
 * This is the SINGLE SOURCE OF TRUTH for which editors have connections.
 * 
 * The log provides: editorUri (the log-style URI) and connectionName
 * We store: Map<logUri, connectionName>
 */
export class SessionTracker {
    private logWatcher: LogWatcher;
    
    // Map of log URI -> connection name (SINGLE SOURCE OF TRUTH)
    private connectionMap = new Map<string, string>();
    
    // Callback for when the map changes
    private onChangeCallback: SessionChangeCallback | undefined;

    constructor() {
        this.logWatcher = new LogWatcher();
        this.logWatcher.setOnActionCallback((action) => this.handleLogAction(action));
    }

    /**
     * Set callback for when the connection map changes
     */
    setOnChangeCallback(callback: SessionChangeCallback): void {
        this.onChangeCallback = callback;
    }

    start(context: vscode.ExtensionContext): void {
        this.logWatcher.start(context);
    }

    stop(): void {
        this.logWatcher.stop();
    }

    /**
     * Handle a worksheet action from the log watcher
     */
    private handleLogAction(action: WorksheetAction): void {
        const logUri = action.editorUri;
        console.log(`[ColorTabs] Log action: ${action.action} logUri="${logUri}" connection="${action.connectionName}"`);
        
        if (action.action === 'Attach') {
            this.connectionMap.set(logUri, action.connectionName);
            this.onChangeCallback?.(logUri, action.connectionName);
        } else if (action.action === 'Detach') {
            this.connectionMap.delete(logUri);
            this.onChangeCallback?.(logUri, undefined);
        }
    }

    /**
     * Get connection name for a VS Code document URI
     */
    getConnectionForDocument(documentUri: vscode.Uri): string | undefined {
        const logUri = SessionTracker.toLogUri(documentUri);
        const conn = this.connectionMap.get(logUri);
        console.log(`[ColorTabs] getConnectionForDocument: docUri="${documentUri.toString()}" logUri="${logUri}" connection="${conn}"`);
        return conn;
    }

    /**
     * Get connection name by log URI directly
     */
    getConnectionByLogUri(logUri: string): string | undefined {
        return this.connectionMap.get(logUri);
    }

    /**
     * Get a copy of the full connection map (for debugging)
     */
    getConnectionMap(): Map<string, string> {
        return new Map(this.connectionMap);
    }

    /**
     * Convert a VS Code document URI to the format used in logs.
     * 
     * Log formats (from sqldeveloper.log):
     * - Untitled: "Untitled-1" (just the name, no path)
     * - File: "/c:/Users/.../file.sql" (path with leading slash)
     * - Database object: "/connection/object/SCHEMA/TYPE/NAME.ext"
     */
    static toLogUri(documentUri: vscode.Uri): string {
        if (documentUri.scheme === 'untitled') {
            // Untitled-1 from "untitled:Untitled-1"
            // documentUri.path is something like "Untitled-1"
            const parts = documentUri.path.split('/');
            return parts[parts.length - 1] || documentUri.path;
        }
        
        if (documentUri.scheme === 'dbtools') {
            // /connection/object/SCHEMA/TYPE/NAME.ext
            return documentUri.path;
        }
        
        if (documentUri.scheme === 'file') {
            // /c:/Users/.../file.sql (path already has leading slash on Windows)
            return documentUri.path;
        }
        
        // Fallback: just use path
        return documentUri.path;
    }
}
