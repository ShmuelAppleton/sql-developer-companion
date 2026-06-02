import * as vscode from 'vscode';
import { RecentObjectsManager } from './recentObjectsManager';
import { RecentObjectsWebviewProvider } from './recentObjectsWebviewProvider';
import type { Api } from '@oracle/sql-developer-api';

const ORACLE_EXTENSION_ID = 'Oracle.sql-developer';

async function getOracleApi(): Promise<Api | undefined> {
    const ext = vscode.extensions.getExtension<Api>(ORACLE_EXTENSION_ID);
    if (!ext) { return undefined; }
    if (!ext.isActive) { await ext.activate(); }
    return ext.exports;
}

function parseConnectionName(uri: vscode.Uri): string | undefined {
    const segments = uri.path.split('/').filter(Boolean);
    return segments.length > 0 ? segments[0] : undefined;
}

async function ensureConnection(api: Api, connectionName: string): Promise<boolean> {
    const connections = api.connections().list();
    const conn = connections.find(
        c => c.name.toLowerCase() === connectionName.toLowerCase()
    );

    if (!conn) {
        vscode.window.showWarningMessage(
            `Connection "${connectionName}" not found. The file may open from cache.`
        );
        return false;
    }

    if (conn.isConnected) {
        return true;
    }

    try {
        await conn.connect();
        return true;
    } catch (err) {
        vscode.window.showWarningMessage(
            `Could not connect to "${connectionName}": ${err instanceof Error ? err.message : String(err)}. The file may open from cache.`
        );
        return false;
    }
}

async function openDbtoolsUri(uri: vscode.Uri, label: string) {
    if (uri.scheme === 'dbtools') {
        const connName = parseConnectionName(uri);
        if (connName) {
            const api = await getOracleApi();
            if (api) {
                await ensureConnection(api, connName);
            }
        }
    }
    try {
        const preview_bool = vscode.workspace.getConfiguration('sqlDevCompanion').get<boolean>('recentObjectsOpenAsPreview', false);
        await vscode.commands.executeCommand('vscode.open', uri, { preview: preview_bool });
    } catch (err) {
        vscode.window.showErrorMessage(
            `Failed to open ${label}: ${err instanceof Error ? err.message : String(err)}`
        );
    }
}

export function activateRecentObjects(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    const manager = new RecentObjectsManager(context);

    // Webview panel in the SQL Developer sidebar
    const webviewProvider = new RecentObjectsWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RecentObjectsWebviewProvider.viewType,
            webviewProvider,
        )
    );

    // Keep webview in sync with history
    webviewProvider.refresh(manager.getRecentItems());
    context.subscriptions.push(
        manager.onDidChange(() => webviewProvider.refresh(manager.getRecentItems()))
    );

    // Handle events from the webview
    context.subscriptions.push(
        webviewProvider.onOpenItem(async item => {
            const uri = vscode.Uri.parse(item.uriString);
            await openDbtoolsUri(uri, item.label);
        })
    );
    context.subscriptions.push(
        webviewProvider.onRemoveItem(uriString => manager.removeItem(uriString))
    );
    context.subscriptions.push(
        webviewProvider.onClearHistory(async () => {
            const answer = await vscode.window.showWarningMessage(
                'Clear all recent Oracle objects history?',
                { modal: true },
                'Clear'
            );
            if (answer === 'Clear') {
                manager.clearHistory();
            }
        })
    );

    // Track documents as they become the active editor (text editors)
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                manager.trackDocument(editor.document);
            }
        })
    );

    // Track custom editor / webview tabs (e.g. table browser)
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(event => {
            for (const tab of event.opened) {
                if (tab.input instanceof vscode.TabInputCustom) {
                    manager.trackUri(tab.input.uri);
                }
            }
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab?.input instanceof vscode.TabInputCustom) {
                manager.trackUri(activeTab.input.uri);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabGroups(() => {
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab?.input instanceof vscode.TabInputCustom) {
                manager.trackUri(activeTab.input.uri);
            }
        })
    );

    // Command: Reopen a recent Oracle object (command palette)
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.reopenRecent', async () => {
            const items = manager.getRecentItems();

            if (items.length === 0) {
                vscode.window.showInformationMessage('No recent Oracle objects found.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                items.map(item => ({
                    label: item.label,
                    description: item.scheme,
                    detail: `${item.uriString}`,
                    uriString: item.uriString,
                })),
                {
                    placeHolder: 'Select an Oracle object to reopen',
                    matchOnDescription: true,
                    matchOnDetail: true,
                }
            );

            if (picked) {
                const uri = vscode.Uri.parse(picked.uriString);
                await openDbtoolsUri(uri, picked.label);
            }
        })
    );

    // Command: Clear history (also available from command palette)
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.clearHistory', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Clear all recent Oracle objects history?',
                { modal: true },
                'Clear'
            );
            if (answer === 'Clear') {
                manager.clearHistory();
            }
        })
    );

    // Track the currently active editor on activation
    if (vscode.window.activeTextEditor) {
        manager.trackDocument(vscode.window.activeTextEditor.document);
    }

    // Also check if a custom editor tab is currently active
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof vscode.TabInputCustom) {
        manager.trackUri(activeTab.input.uri);
    }

    outputChannel.appendLine('Recent Objects feature activated');
}
