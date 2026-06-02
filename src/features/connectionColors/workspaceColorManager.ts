import * as vscode from 'vscode';
import type { ConnectionInfo, ConnectionRule } from './types';

/**
 * Manages Peacock-like workspace coloring based on the active worksheet connection.
 * Updates title bar, activity bar, and status bar colors.
 * Only works when a workspace is open (to avoid affecting other VS Code windows).
 */
export class WorkspaceColorManager {
    private currentColor: string | undefined;
    private originalColors: Record<string, string | undefined> = {};
    private isInitialized = false;

    /**
     * All color keys that we might manage
     */
    private readonly allColorKeys = [
        // Title bar
        'titleBar.activeBackground',
        'titleBar.activeForeground',
        'titleBar.inactiveBackground',
        'titleBar.inactiveForeground',
        // Activity bar
        'activityBar.background',
        'activityBar.foreground',
        'activityBar.inactiveForeground',
        'activityBar.activeBorder',
        // Status bar (background style)
        'statusBar.background',
        'statusBar.foreground',
        'statusBar.debuggingBackground',
        'statusBar.debuggingForeground',
        'statusBar.noFolderBackground',
        'statusBar.noFolderForeground',
        // Status bar (border style)
        'statusBar.border',
    ];

    /**
     * Only apply workspace colors when a workspace is open
     */
    private hasWorkspace(): boolean {
        return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    }

    /**
     * Apply workspace colors based on connection info
     * Only applies when a workspace is open to avoid affecting other VS Code windows
     */
    async applyColorsForConnection(connectionInfo: ConnectionInfo | undefined): Promise<void> {
        console.log(`[ColorTabs] applyColorsForConnection: hasWorkspace=${this.hasWorkspace()}, connectionInfo=${JSON.stringify(connectionInfo)}`);
        
        // Only apply workspace colors when a workspace is open
        if (!this.hasWorkspace()) {
            console.log(`[ColorTabs] applyColorsForConnection: no workspace, returning`);
            return;
        }

        if (!connectionInfo) {
            console.log(`[ColorTabs] applyColorsForConnection: no connectionInfo, clearing colors`);
            await this.clearColors();
            return;
        }

        const rule = this.findMatchingRule(connectionInfo);
        const color = rule?.workspaceColor;
        console.log(`[ColorTabs] applyColorsForConnection: rule=${JSON.stringify(rule)}, color=${color}`);

        if (!color) {
            console.log(`[ColorTabs] applyColorsForConnection: no color in rule, clearing`);
            await this.clearColors();
            return;
        }

        console.log(`[ColorTabs] applyColorsForConnection: applying color ${color}`);
        await this.applyColor(color);
    }

    /**
     * Find matching connection rule by connection name
     */
    private findMatchingRule(connectionInfo: ConnectionInfo): ConnectionRule | undefined {
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const rules = config.get<ConnectionRule[]>('connectionRules', []);
        return rules.find(r => r.connectionName === connectionInfo.connectionName);
    }

    /**
     * Apply a color to the workspace (only when workspace is open)
     */
    private async applyColor(hexColor: string): Promise<void> {

        // Store original colors on first apply
        if (!this.isInitialized) {
            await this.storeOriginalColors();
            this.isInitialized = true;
        }

        const colorCustomizations = this.generateColorCustomizations(hexColor);
        
        // Merge with existing customizations
        const config = vscode.workspace.getConfiguration('workbench');
        const existing = config.get<Record<string, string>>('colorCustomizations', {});
        const merged = { ...existing, ...colorCustomizations };
        
        await config.update(
            'colorCustomizations',
            merged,
            vscode.ConfigurationTarget.Workspace
        );

        this.currentColor = hexColor;
    }

    /**
     * Generate color customizations object from a base color based on user settings
     */
    private generateColorCustomizations(hexColor: string): Record<string, string> {
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const colorTitleBar = config.get<boolean>('colorTitleBar', true);
        const colorActivityBar = config.get<boolean>('colorActivityBar', true);
        const colorStatusBar = config.get<boolean>('colorStatusBar', true);
        const statusBarStyle = config.get<string>('statusBarStyle', 'background');

        const baseColor = hexColor;
        const lighterColor = this.adjustBrightness(hexColor, 20);
        const darkerColor = this.adjustBrightness(hexColor, -20);
        const foregroundColor = this.getContrastColor(hexColor);

        const customizations: Record<string, string> = {};

        if (colorTitleBar) {
            customizations['titleBar.activeBackground'] = baseColor;
            customizations['titleBar.activeForeground'] = foregroundColor;
            customizations['titleBar.inactiveBackground'] = darkerColor;
            customizations['titleBar.inactiveForeground'] = this.adjustBrightness(foregroundColor, -30);
        }

        if (colorActivityBar) {
            customizations['activityBar.background'] = baseColor;
            customizations['activityBar.foreground'] = foregroundColor;
            customizations['activityBar.inactiveForeground'] = this.adjustBrightness(foregroundColor, -40);
            customizations['activityBar.activeBorder'] = foregroundColor;
        }

        if (colorStatusBar) {
            if (statusBarStyle === 'border') {
                // Border-only style: just add a colored border at the top, don't change background
                customizations['statusBar.border'] = baseColor;
            } else {
                // Full background style
                customizations['statusBar.background'] = baseColor;
                customizations['statusBar.foreground'] = foregroundColor;
                customizations['statusBar.noFolderBackground'] = baseColor;
                customizations['statusBar.noFolderForeground'] = foregroundColor;
                customizations['statusBar.debuggingBackground'] = lighterColor;
                customizations['statusBar.debuggingForeground'] = foregroundColor;
            }
        }

        return customizations;
    }

    /**
     * Store original color customizations before we modify them
     */
    private async storeOriginalColors(): Promise<void> {
        const config = vscode.workspace.getConfiguration('workbench');
        const existing = config.get<Record<string, string>>('colorCustomizations', {});
        
        for (const key of this.allColorKeys) {
            this.originalColors[key] = existing[key];
        }
    }

    /**
     * Clear applied colors and restore originals (only when workspace is open)
     */
    async clearColors(): Promise<void> {
        if (!this.hasWorkspace()) {
            return;
        }

        const config = vscode.workspace.getConfiguration('workbench');
        const existing = config.get<Record<string, string>>('colorCustomizations', {});
        
        // Remove our color keys
        const updated = { ...existing };
        let changed = false;
        for (const key of this.allColorKeys) {
            if (key in updated) {
                delete updated[key];
                changed = true;
            }
        }

        if (changed) {
            await config.update(
                'colorCustomizations',
                Object.keys(updated).length > 0 ? updated : undefined,
                vscode.ConfigurationTarget.Workspace
            );
        }

        this.currentColor = undefined;
        this.isInitialized = false;
        this.originalColors = {};
    }

    /**
     * Adjust brightness of a hex color
     */
    private adjustBrightness(hex: string, percent: number): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, Math.min(255, (num >> 16) + amt));
        const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
        const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
        return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    }

    /**
     * Get a contrasting foreground color (black or white)
     */
    private getContrastColor(hex: string): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const R = num >> 16;
        const G = (num >> 8) & 0x00FF;
        const B = num & 0x0000FF;
        // Calculate relative luminance
        const luminance = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    /**
     * Dispose and restore original colors
     */
    async dispose(): Promise<void> {
        await this.clearColors();
    }
}
