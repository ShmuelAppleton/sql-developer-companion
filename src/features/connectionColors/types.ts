/**
 * Connection information for a worksheet - just the connection name from the logs
 */
export interface ConnectionInfo {
    /** The connection name as defined in SQL Developer */
    connectionName: string;
}

/**
 * Configuration rule for matching connections to badges/colors
 */
export interface ConnectionRule {
    /** The connection name to match */
    connectionName: string;
    /** Badge to display on tab (1-2 characters/emojis) */
    badge?: string;
    /** Hex color for workspace (title bar, activity bar, status bar) - Peacock style */
    workspaceColor?: string;
}
