import * as vscode from 'vscode';
import { PlsqlDefinitionProvider } from './definitionProvider';
import { PlsqlHoverProvider } from './hoverProvider';
import { PlsqlParser } from './plsqlParser';
import { WorkspaceIndexer } from './workspaceIndexer';

const PLSQL_SELECTOR: vscode.DocumentSelector = [
    { language: 'oracle-sql' },
    { language: 'oracle-sql', scheme: 'dbtools' },
    { language: 'oracle-sql', scheme: 'file' }
];

export function activatePlsqlNavigation(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    const parser = new PlsqlParser();

    // Create workspace indexer for cross-file navigation
    const workspaceIndexer = new WorkspaceIndexer(outputChannel);

    // Register Definition Provider
    const definitionProvider = new PlsqlDefinitionProvider(outputChannel, workspaceIndexer);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(PLSQL_SELECTOR, definitionProvider)
    );

    // Register Hover Provider
    const hoverProvider = new PlsqlHoverProvider(outputChannel, workspaceIndexer);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(PLSQL_SELECTOR, hoverProvider)
    );

    // "Go to Local Definition" command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.goToLocal', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No active editor');
                return;
            }

            const document = editor.document;
            const position = editor.selection.active;

            const word = parser.getWordAtPosition(document, position);
            if (!word) {
                vscode.window.showInformationMessage('No word under cursor');
                return;
            }

            const definitions = parser.parseDocument(document);
            const definition = parser.findDefinition(definitions, word);

            if (definition) {
                if (position.line === definition.line) {
                    vscode.window.showInformationMessage(`Already at definition of "${word}"`);
                    return;
                }

                const targetPosition = new vscode.Position(definition.line, definition.column);
                editor.selection = new vscode.Selection(targetPosition, targetPosition);
                editor.revealRange(
                    new vscode.Range(targetPosition, targetPosition),
                    vscode.TextEditorRevealType.InCenter
                );
                outputChannel.appendLine(`Jumped to ${definition.type} "${definition.name}" at line ${definition.line + 1}`);
            } else {
                vscode.window.showInformationMessage(`No local definition found for "${word}"`);
            }
        })
    );

    // Command to show indexer stats
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.showPlsqlStats', () => {
            const stats = workspaceIndexer.getStats();
            vscode.window.showInformationMessage(
                `PL/SQL Index: ${stats.fileCount} files, ${stats.symbolCount} symbols${stats.isIndexing ? ' (indexing...)' : ''}`
            );
        })
    );

    // Command to re-index workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlDevCompanion.reindexPlsql', async () => {
            vscode.window.showInformationMessage('Re-indexing PL/SQL workspace...');
            workspaceIndexer.clear();
            await workspaceIndexer.initialize();
            const stats = workspaceIndexer.getStats();
            vscode.window.showInformationMessage(
                `PL/SQL Index complete: ${stats.fileCount} files, ${stats.symbolCount} symbols`
            );
        })
    );

    // Set up file watchers to keep index up to date
    workspaceIndexer.setupFileWatchers(context);

    // Add indexer to subscriptions for proper disposal
    context.subscriptions.push({ dispose: () => workspaceIndexer.dispose() });

    // Initialize workspace indexer in the background
    workspaceIndexer.initialize()
        .then(() => {
            const stats = workspaceIndexer.getStats();
            outputChannel.appendLine(`PL/SQL workspace indexed: ${stats.fileCount} files, ${stats.symbolCount} symbols`);
        })
        .catch(() => {
            // Silently ignore - extension might be deactivating
        });

    outputChannel.appendLine('PL/SQL Navigation feature activated');
}
