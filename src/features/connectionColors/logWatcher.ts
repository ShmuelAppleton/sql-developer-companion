import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WorksheetAction {
    action: 'Attach' | 'Detach';
    connectionName: string;
    editorUri: string;
    sessionUrl?: string;
    timestamp: Date;
}

export type WorksheetActionCallback = (action: WorksheetAction) => void;

/**
 * Watches the Oracle SQL Developer log file for worksheet attach/detach events.
 * The log file is in JSON Lines format - each line is a complete JSON object.
 * This is more reliable than API events for tracking connection state changes.
 */
export class LogWatcher {
    private logWatcher: fs.FSWatcher | undefined;
    private lastLogPosition = 0;
    private pollInterval: NodeJS.Timeout | undefined;
    private activationTimestamp: Date;
    private dbtoolsProcessId: string | undefined;
    private onActionCallback: WorksheetActionCallback | undefined;
    private readonly POLL_INTERVAL_MS = 1000; // Poll every second

    constructor() {
        this.activationTimestamp = new Date();
    }

    /**
     * Set the callback to be invoked when worksheet actions are detected
     */
    setOnActionCallback(callback: WorksheetActionCallback): void {
        this.onActionCallback = callback;
    }

    /**
     * Get the path to the SQL Developer log file
     */
    private getLogFilePath(): string {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'DBTools', 'logs', 'sqldeveloper.log');
    }

    /**
     * Parse a timestamp from a log entry (ISO format from JSON)
     */
    private parseLogTimestamp(timestampStr: string): Date | null {
        try {
            return new Date(timestampStr);
        } catch (e) {
            return null;
        }
    }

    /**
     * Check if a log entry is from our DBTools server process
     */
    private isOurProcess(logEntry: any): boolean {
        if (!this.dbtoolsProcessId) {
            return true;
        }
        
        const component = logEntry.component || '';
        if (component.includes(`(${this.dbtoolsProcessId})`)) {
            return true;
        }
        
        // Worksheet entries don't include process ID in component
        if (component === 'Worksheet') {
            return true;
        }
        
        return false;
    }

    /**
     * Try to extract DBTools server process ID from a log entry
     */
    private tryExtractProcessId(logEntry: any): string | null {
        const component = logEntry.component || '';
        const match = component.match(/DBToolsServerApp\((\d+)\)/);
        if (match) {
            return match[1];
        }
        return null;
    }

    /**
     * Parse a single log line (JSON) and extract worksheet attachment info
     */
    private parseLogLine(line: string): WorksheetAction | null {
        try {
            const logEntry = JSON.parse(line);
            
            // Check timestamp is after activation
            const timestamp = this.parseLogTimestamp(logEntry.timestamp);
            if (!timestamp || timestamp < this.activationTimestamp) {
                return null;
            }
            
            // Check if this is from our process
            if (!this.isOurProcess(logEntry)) {
                return null;
            }
            
            // Look for Worksheet component with "Action details" message
            if (logEntry.component === 'Worksheet' && logEntry.message?.includes('Action details')) {
                // The action JSON is embedded in the message after "Action details\n"
                const messageMatch = logEntry.message.match(/Action details\n(.+)/s);
                if (messageMatch) {
                    const actionDetails = JSON.parse(messageMatch[1]);
                    
                    if (actionDetails.action && actionDetails.connection?.name && actionDetails.worksheet?.uri) {
                        return {
                            action: actionDetails.action as 'Attach' | 'Detach',
                            connectionName: actionDetails.connection.name,
                            editorUri: actionDetails.worksheet.uri,
                            sessionUrl: actionDetails.session,
                            timestamp
                        };
                    }
                }
            }
        } catch (e) {
            // Not a valid JSON line or doesn't match our pattern
        }
        return null;
    }

    /**
     * Read new log entries from the log file
     */
    private readNewLogEntries(): void {
        const logPath = this.getLogFilePath();
        
        if (!fs.existsSync(logPath)) {
            return;
        }
        
        try {
            const stats = fs.statSync(logPath);
            const fileSize = stats.size;
            
            // Handle log rotation
            if (fileSize < this.lastLogPosition) {
                this.lastLogPosition = 0;
            }
            
            // Read new content
            if (fileSize > this.lastLogPosition) {
                const fd = fs.openSync(logPath, 'r');
                const bufferSize = fileSize - this.lastLogPosition;
                const buffer = Buffer.alloc(bufferSize);
                
                fs.readSync(fd, buffer, 0, bufferSize, this.lastLogPosition);
                fs.closeSync(fd);
                
                const newContent = buffer.toString('utf8');
                const lines = newContent.split('\n');
                
                for (const line of lines) {
                    if (line.trim()) {
                        // Try to identify our DBTools process ID
                        if (!this.dbtoolsProcessId) {
                            try {
                                const entry = JSON.parse(line);
                                const pid = this.tryExtractProcessId(entry);
                                if (pid) {
                                    const ts = this.parseLogTimestamp(entry.timestamp);
                                    if (ts && ts >= this.activationTimestamp) {
                                        this.dbtoolsProcessId = pid;
                                    }
                                }
                            } catch (e) {
                                // Ignore
                            }
                        }
                        
                        // Parse the line for worksheet actions
                        const action = this.parseLogLine(line);
                        if (action && this.onActionCallback) {
                            this.onActionCallback(action);
                        }
                    }
                }
                
                this.lastLogPosition = fileSize;
            }
        } catch (e) {
            // Error reading log file - will retry on next poll
        }
    }

    /**
     * Initialize log position to current end of file (skip historical data)
     */
    private initializeLogPosition(): void {
        const logPath = this.getLogFilePath();
        
        if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            this.lastLogPosition = stats.size;
        } else {
            this.lastLogPosition = 0;
        }
    }

    /**
     * Start watching the log file
     */
    start(context: vscode.ExtensionContext): void {
        const logPath = this.getLogFilePath();
        
        // Initialize to current end of file
        this.initializeLogPosition();
        
        // Try to use file system watcher
        try {
            this.logWatcher = fs.watch(logPath, (eventType) => {
                if (eventType === 'change') {
                    this.readNewLogEntries();
                }
            });
            
            context.subscriptions.push({
                dispose: () => {
                    if (this.logWatcher) {
                        this.logWatcher.close();
                        this.logWatcher = undefined;
                    }
                }
            });
        } catch (e) {
            // File watcher not available
        }
        
        // Poll as fallback (some file systems don't trigger watch events reliably)
        this.pollInterval = setInterval(() => {
            this.readNewLogEntries();
        }, this.POLL_INTERVAL_MS);
        
        context.subscriptions.push({
            dispose: () => {
                if (this.pollInterval) {
                    clearInterval(this.pollInterval);
                    this.pollInterval = undefined;
                }
            }
        });
    }

    /**
     * Stop watching the log file
     */
    stop(): void {
        if (this.logWatcher) {
            this.logWatcher.close();
            this.logWatcher = undefined;
        }
        
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = undefined;
        }
    }
}
