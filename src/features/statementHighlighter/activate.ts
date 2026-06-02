import * as vscode from 'vscode';
import { StatementHighlighter } from './statementHighlighter';

export function activateStatementHighlighter(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    const highlighter = new StatementHighlighter(outputChannel);
    context.subscriptions.push({ dispose: () => highlighter.dispose() });

    // Command to clear the statement highlight
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.clearHighlight', () => {
            highlighter.clearHighlight();
        })
    );

    // Hook into Oracle SQL Developer extension API
    setupOracleSqlDeveloperIntegration(highlighter, outputChannel);

    outputChannel.appendLine('Statement Highlighter feature activated');
}

async function setupOracleSqlDeveloperIntegration(
    highlighter: StatementHighlighter,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    try {
        const oracleExtension = vscode.extensions.getExtension('Oracle.sql-developer');

        if (!oracleExtension) {
            outputChannel.appendLine('[Highlighter] Oracle SQL Developer extension not found');
            return;
        }

        if (!oracleExtension.isActive) {
            outputChannel.appendLine('[Highlighter] Waiting for Oracle SQL Developer extension to activate...');
            await oracleExtension.activate();
        }

        const api = oracleExtension.exports;

        if (!api) {
            outputChannel.appendLine('[Highlighter] Oracle SQL Developer extension has no exported API');
            return;
        }

        if (typeof api.worksheets !== 'function') {
            outputChannel.appendLine('[Highlighter] Oracle SQL Developer API does not have worksheets() method');
            return;
        }

        const worksheetsApi = api.worksheets();

        if (!worksheetsApi || typeof worksheetsApi.onDidExecuteCommand !== 'function') {
            outputChannel.appendLine('[Highlighter] Worksheets API does not have onDidExecuteCommand event');
            return;
        }

        worksheetsApi.onDidExecuteCommand((event: any) => {
            highlighter.handleExecuteCommand(event);
        });

        outputChannel.appendLine('[Highlighter] Successfully hooked into Oracle SQL Developer worksheets.onDidExecuteCommand');

    } catch (error) {
        outputChannel.appendLine(`[Highlighter] Error setting up integration: ${error}`);
    }
}
