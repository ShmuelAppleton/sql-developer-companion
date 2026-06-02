import * as vscode from 'vscode';
import type { Api } from '@oracle/sql-developer-api';
import { WorksheetManager } from './worksheetManager';
import { TabDecorationProvider } from './tabDecorationProvider';
import { WorkspaceColorManager } from './workspaceColorManager';
import { SessionTracker } from './sessionTracker';
import type { ConnectionRule } from './types';

const LOGGING_PROMPT_KEY = 'sqlDevCompanion.loggingPromptShown';

async function ensureLoggingSettings(context: vscode.ExtensionContext): Promise<void> {
    const sqlDevConfig = vscode.workspace.getConfiguration('sqldeveloper');
    const loggingLevel = sqlDevConfig.get<string>('logging.level');
    const loggingToFile = sqlDevConfig.get<boolean>('logging.toFile');

    const isConfigured = loggingLevel === 'TRACE' && loggingToFile === true;

    if (isConfigured) {
        return;
    }

    const alreadyPrompted = context.globalState.get<boolean>(LOGGING_PROMPT_KEY);
    if (alreadyPrompted) {
        return;
    }

    const configure = 'Configure Now';
    const later = 'Later';
    const dontAsk = "Don't Ask Again";

    const result = await vscode.window.showWarningMessage(
        'SQL Developer Companion: Connection Color Tabs requires SQL Developer logging to be enabled. Configure now?',
        configure,
        later,
        dontAsk
    );

    if (result === configure) {
        try {
            await sqlDevConfig.update('logging.level', 'TRACE', vscode.ConfigurationTarget.Global);
            await sqlDevConfig.update('logging.toFile', true, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
                'SQL Developer logging configured. Please reload VS Code for changes to take effect.',
                'Reload'
            ).then(selection => {
                if (selection === 'Reload') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch {
            vscode.window.showErrorMessage('Failed to configure logging settings. Please set them manually in settings.');
        }
    } else if (result === dontAsk) {
        await context.globalState.update(LOGGING_PROMPT_KEY, true);
    }
}

export async function activateConnectionColors(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    const oracleExtension = vscode.extensions.getExtension('Oracle.sql-developer');
    if (!oracleExtension) {
        outputChannel.appendLine('[ConnectionColors] Oracle SQL Developer extension not found');
        return;
    }

    if (!oracleExtension.isActive) {
        await oracleExtension.activate();
    }

    const api = oracleExtension.exports as Api;

    await ensureLoggingSettings(context);

    // Initialize session tracker (single source of truth for connections)
    const sessionTracker = new SessionTracker();

    // Initialize decoration provider and link to session tracker
    const decorationProvider = new TabDecorationProvider();
    decorationProvider.setSessionTracker(sessionTracker);
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider)
    );

    // Initialize worksheet manager
    const worksheetManager = new WorksheetManager(api, decorationProvider);
    worksheetManager.registerEventHandlers(context);

    // Initialize workspace color manager
    const workspaceColorManager = new WorkspaceColorManager();
    context.subscriptions.push({ dispose: () => workspaceColorManager.dispose() });

    // When connection map changes, update decorations and colors
    sessionTracker.setOnChangeCallback((logUri, connectionName) => {
        decorationProvider.fireChangeForLogUri(logUri);
        updateWorkspaceColors(sessionTracker, workspaceColorManager);
    });

    sessionTracker.start(context);
    context.subscriptions.push({ dispose: () => sessionTracker.stop() });

    // Update colors on active editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateWorkspaceColors(sessionTracker, workspaceColorManager);
        })
    );

    // Register commands
    registerCommands(context, worksheetManager, decorationProvider, sessionTracker, workspaceColorManager);

    // Clear stale workspace colors from previous session
    workspaceColorManager.clearColors();

    outputChannel.appendLine('Connection Colors feature activated');
}

function updateWorkspaceColors(sessionTracker: SessionTracker, workspaceColorManager: WorkspaceColorManager): void {
    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) {
        workspaceColorManager.applyColorsForConnection(undefined);
        return;
    }

    const uri = activeEditor.document.uri;
    const connectionName = sessionTracker.getConnectionForDocument(uri);

    if (connectionName) {
        workspaceColorManager.applyColorsForConnection({ connectionName });
    } else {
        workspaceColorManager.applyColorsForConnection(undefined);
    }
}

function extractConnectionInfo(treeItem: any): { connectionName: string; serviceName: string; username: string } | undefined {
    if (!treeItem?.connection?.definition) {
        vscode.window.showErrorMessage('Could not get connection information from the selected item.');
        return undefined;
    }

    const definition = treeItem.connection.definition;
    const connectionName = definition.name || treeItem.nodeName || 'Unknown';
    const serviceName = definition.serviceName || '';

    let username = '';
    if (treeItem.tooltip) {
        const atIndex = treeItem.tooltip.indexOf('@');
        if (atIndex > 0) {
            username = treeItem.tooltip.substring(0, atIndex);
        }
    }

    return { connectionName, serviceName, username };
}

function getOrCreateRule(connectionName: string): { rules: ConnectionRule[]; existingRule: ConnectionRule | undefined; existingRuleIndex: number } {
    const config = vscode.workspace.getConfiguration('sqlDevCompanion');
    const rules = config.get<ConnectionRule[]>('connectionRules', []);
    const existingRuleIndex = rules.findIndex(rule => rule.connectionName === connectionName);
    const existingRule = existingRuleIndex >= 0 ? rules[existingRuleIndex] : undefined;
    return { rules, existingRule, existingRuleIndex };
}

function registerCommands(
    context: vscode.ExtensionContext,
    worksheetManager: WorksheetManager,
    decorationProvider: TabDecorationProvider,
    sessionTracker: SessionTracker,
    workspaceColorManager: WorkspaceColorManager
) {
    // Command: Refresh decorations
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.refreshBadges', () => {
            worksheetManager.refreshAllWorksheets();
        })
    );

    // Command: Set badge for a connection
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.setBadge', async (treeItem: any) => {
            try {
                const connInfo = extractConnectionInfo(treeItem);
                if (!connInfo) return;

                const { connectionName } = connInfo;
                const { rules, existingRule, existingRuleIndex } = getOrCreateRule(connectionName);

                const badgeOptions: vscode.QuickPickItem[] = [
                    { label: '🔴', description: 'Red circle - Production' },
                    { label: '🟠', description: 'Orange circle - Staging' },
                    { label: '🟡', description: 'Yellow circle - UAT' },
                    { label: '🟢', description: 'Green circle - Development' },
                    { label: '🔵', description: 'Blue circle - Test' },
                    { label: '🟣', description: 'Purple circle' },
                    { label: '⚪', description: 'White circle' },
                    { label: '⚫', description: 'Black circle' },
                    { label: '🟤', description: 'Brown circle' },
                    { label: '⚠️', description: 'Warning' },
                    { label: '🚨', description: 'Alert/Critical' },
                    { label: '✅', description: 'Checkmark/Safe' },
                    { label: '❌', description: 'X mark/Blocked' },
                    { label: '⛔', description: 'No entry/Forbidden' },
                    { label: '🚫', description: 'Prohibited' },
                    { label: '💾', description: 'Database/Save' },
                    { label: '🗄️', description: 'File cabinet/Archive' },
                    { label: '🔧', description: 'Wrench/Maintenance' },
                    { label: '🔒', description: 'Locked/Secure' },
                    { label: '🔓', description: 'Unlocked' },
                    { label: '🏭', description: 'Factory/Production' },
                    { label: '🧪', description: 'Test tube/Testing' },
                    { label: '🔬', description: 'Microscope/Research' },
                    { label: '🏗️', description: 'Construction/Development' },
                    { label: '🎭', description: 'Theater/Staging' },
                    { label: '⭐', description: 'Star/Important' },
                    { label: '💎', description: 'Gem/Premium' },
                    { label: '🔥', description: 'Fire/Hot' },
                    { label: '❄️', description: 'Snowflake/Cold/Frozen' },
                    { label: '👤', description: 'User/Personal' },
                    { label: '$(close) Clear badge', description: 'Remove badge' },
                    { label: '$(edit) Custom emoji/text...', description: 'Enter custom badge (up to 2 emojis or characters)' }
                ];

                const selectedBadge = await vscode.window.showQuickPick(badgeOptions, {
                    placeHolder: `Select a badge for "${connectionName}"`,
                    title: existingRule?.badge ? `Current badge: ${existingRule.badge}` : undefined
                });

                if (!selectedBadge) return;

                let badge: string | undefined;

                if (selectedBadge.label === '$(close) Clear badge') {
                    badge = undefined;
                } else if (selectedBadge.label === '$(edit) Custom emoji/text...') {
                    const customBadge = await vscode.window.showInputBox({
                        prompt: 'Enter custom badge (up to 2 emojis or characters)',
                        placeHolder: 'e.g., 🔴🟢, PR, DV, ⚠️🔒',
                        value: existingRule?.badge || '',
                        validateInput: (value) => {
                            if (!value) return undefined;
                            const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
                            const graphemes = [...segmenter.segment(value)];
                            if (graphemes.length > 2) {
                                return `Badge must be 1-2 characters/emojis (you entered ${graphemes.length})`;
                            }
                            return undefined;
                        }
                    });
                    if (customBadge === undefined) return;
                    badge = customBadge || undefined;
                } else {
                    badge = selectedBadge.label;

                    const secondBadgeOptions: vscode.QuickPickItem[] = [
                        { label: '$(check) Done', description: `Use "${badge}" as the badge` },
                        { label: '$(add) Add second emoji...', description: 'Select another emoji to combine' }
                    ];

                    const addSecond = await vscode.window.showQuickPick(secondBadgeOptions, {
                        placeHolder: `Add a second emoji to "${badge}"?`
                    });

                    if (!addSecond) return;

                    if (addSecond.label === '$(add) Add second emoji...') {
                        const secondEmojiOptions = badgeOptions.filter(opt => !opt.label.startsWith('$('));
                        const secondEmoji = await vscode.window.showQuickPick(secondEmojiOptions, {
                            placeHolder: `Select second emoji to add to "${badge}"`
                        });

                        if (secondEmoji) {
                            badge = badge + secondEmoji.label;
                        }
                    }
                }

                const config = vscode.workspace.getConfiguration('sqlDevCompanion');
                const newRule: ConnectionRule = {
                    ...(existingRule || {}),
                    connectionName,
                    badge
                };

                if (existingRuleIndex >= 0) {
                    rules[existingRuleIndex] = newRule;
                } else {
                    rules.push(newRule);
                }

                await config.update('connectionRules', rules, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Badge set for "${connectionName}": "${badge || '(cleared)'}"`);
                decorationProvider.refreshAll();
            } catch {
                // User cancelled
            }
        })
    );

    // Command: Set workspace color for a connection
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.setWorkspaceColor', async (treeItem: any) => {
            try {
                const connInfo = extractConnectionInfo(treeItem);
                if (!connInfo) return;

                const { connectionName } = connInfo;
                const { rules, existingRule, existingRuleIndex } = getOrCreateRule(connectionName);

                const colorOptions: vscode.QuickPickItem[] = [
                    { label: '🔴 Red', description: '#FF5252' },
                    { label: '🟢 Green', description: '#4CAF50' },
                    { label: '🟠 Orange', description: '#FF9800' },
                    { label: '🟣 Purple', description: '#9C27B0' },
                    { label: '🔵 Blue', description: '#2196F3' },
                    { label: '🟡 Yellow', description: '#FFEB3B' },
                    { label: '🟤 Brown', description: '#795548' },
                    { label: '⚫ Black', description: '#212121' },
                    { label: '⚪ Gray', description: '#607D8B' },
                    { label: '$(edit) Custom hex color...', description: 'custom' },
                    { label: '$(close) Clear workspace color', description: 'none' }
                ];

                const selectedColor = await vscode.window.showQuickPick(colorOptions, {
                    placeHolder: `Select workspace color for "${connectionName}"`,
                    title: existingRule?.workspaceColor ? `Current color: ${existingRule.workspaceColor}` : undefined
                });

                if (!selectedColor) return;

                let workspaceColor: string | undefined;

                if (selectedColor.description === 'custom') {
                    const customColor = await vscode.window.showInputBox({
                        prompt: 'Enter a hex color (e.g., #FF5252)',
                        placeHolder: '#FF5252',
                        value: existingRule?.workspaceColor || '#',
                        validateInput: (value) => {
                            if (value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
                                return 'Please enter a valid hex color (e.g., #FF5252)';
                            }
                            return undefined;
                        }
                    });
                    if (customColor === undefined) return;
                    workspaceColor = customColor || undefined;
                } else if (selectedColor.description === 'none') {
                    workspaceColor = undefined;
                } else {
                    workspaceColor = selectedColor.description;
                }

                const config = vscode.workspace.getConfiguration('sqlDevCompanion');
                const newRule: ConnectionRule = {
                    ...(existingRule || {}),
                    connectionName,
                    workspaceColor
                };

                if (existingRuleIndex >= 0) {
                    rules[existingRuleIndex] = newRule;
                } else {
                    rules.push(newRule);
                }

                await config.update('connectionRules', rules, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `Workspace color set for "${connectionName}": ${workspaceColor || '(cleared)'}`
                );
                updateWorkspaceColors(sessionTracker, workspaceColorManager);
            } catch {
                // User cancelled
            }
        })
    );
}
