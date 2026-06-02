import * as vscode from 'vscode';
import { activateRecentObjects } from './features/recentObjects/activate';
import { activatePlsqlNavigation } from './features/plsqlNavigation/activate';
import { activateStatementHighlighter } from './features/statementHighlighter/activate';
import { activateConnectionColors } from './features/connectionColors/activate';

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('SQL Developer Companion');
    outputChannel.appendLine('SQL Developer Companion activated');

    activateRecentObjects(context, outputChannel);
    activatePlsqlNavigation(context, outputChannel);
    activateStatementHighlighter(context, outputChannel);
    activateConnectionColors(context, outputChannel);
}

export function deactivate() {}
