import * as vscode from 'vscode';

/**
 * Highlights the currently executed SQL statement in the worksheet editor
 * Works with Oracle SQL Developer extension's onDidExecuteCommand event
 * 
 * Decorations persist until:
 * - The document is closed
 * - A new query is run on the same worksheet
 * - Manually cleared via command
 */
export class StatementHighlighter {
    
    private outputChannel: vscode.OutputChannel;
    private decorationType: vscode.TextEditorDecorationType;
    
    // Track decorations by document URI so they persist across tab switches
    private documentDecorations: Map<string, vscode.Range> = new Map();
    
    // Disposables for event listeners
    private disposables: vscode.Disposable[] = [];
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        
        // Create decoration type based on user's style preference
        this.decorationType = this.createDecorationType();
        
        // Recreate decoration when settings change
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('sqlDevCompanion.highlightStyle') ||
                    e.affectsConfiguration('sqlDevCompanion.highlightCustomBackground') ||
                    e.affectsConfiguration('sqlDevCompanion.highlightCustomBorder')) {
                    this.decorationType.dispose();
                    this.decorationType = this.createDecorationType();
                    // Reapply existing decorations with new style
                    this.reapplyDecorations(vscode.window.visibleTextEditors);
                }
            })
        );
        
        // Reapply decorations when editor becomes visible (tab switch)
        this.disposables.push(
            vscode.window.onDidChangeVisibleTextEditors((editors) => {
                this.reapplyDecorations(editors);
            })
        );
        
        // Clear decoration when document is closed
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const uri = document.uri.toString();
                if (this.documentDecorations.has(uri)) {
                    this.documentDecorations.delete(uri);
                    this.outputChannel.appendLine(`[Highlighter] Cleared decoration for closed document: ${uri}`);
                }
            })
        );
    }
    
    private createDecorationType(): vscode.TextEditorDecorationType {
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const style = config.get<string>('highlightStyle', 'subtle');
        
        switch (style) {
            case 'subtle':
                return vscode.window.createTextEditorDecorationType({
                    backgroundColor: 'rgba(100, 150, 255, 0.08)',
                    border: '1px solid rgba(100, 150, 255, 0.3)',
                    isWholeLine: false,
                    overviewRulerColor: 'rgba(100, 150, 255, 0.5)',
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
            case 'moderate':
                return vscode.window.createTextEditorDecorationType({
                    backgroundColor: 'rgba(60, 120, 230, 0.18)',
                    border: '1px solid rgba(60, 120, 230, 0.5)',
                    isWholeLine: false,
                    overviewRulerColor: 'rgba(60, 120, 230, 0.6)',
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
            case 'bold':
                return vscode.window.createTextEditorDecorationType({
                    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                    border: '1px solid',
                    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
                    isWholeLine: false,
                    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
            case 'border-only':
                return vscode.window.createTextEditorDecorationType({
                    borderWidth: '0 0 0 3px',
                    borderStyle: 'solid',
                    borderColor: 'rgba(60, 120, 230, 0.7)',
                    isWholeLine: true,
                    overviewRulerColor: 'rgba(60, 120, 230, 0.5)',
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
            case 'custom': {
                const bg = config.get<string>('highlightCustomBackground', 'rgba(100, 150, 255, 0.15)');
                const border = config.get<string>('highlightCustomBorder', 'rgba(100, 150, 255, 0.5)');
                return vscode.window.createTextEditorDecorationType({
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    isWholeLine: false,
                    overviewRulerColor: border,
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
            }
            default:
                return vscode.window.createTextEditorDecorationType({
                    backgroundColor: 'rgba(100, 150, 255, 0.08)',
                    border: '1px solid rgba(100, 150, 255, 0.3)',
                    isWholeLine: false,
                    overviewRulerColor: 'rgba(100, 150, 255, 0.5)',
                    overviewRulerLane: vscode.OverviewRulerLane.Center
                });
        }
    }
    
    /**
     * Handle the onDidExecuteCommand event from Oracle SQL Developer
     * Expected structure:
     * {
     *   worksheet: { editor: TextEditor, selection: ... },
     *   commandId: 'sqldeveloper.worksheet.runStatement',
     *   result: {
     *     data: {
     *       items: [{
     *         statementPos: { startLine: number, endLine: number },
     *         statementText: string
     *       }]
     *     }
     *   }
     * }
     * 
     * NOTE: statementPos is relative to the statement block, not the editor!
     * We use statementText to find the actual location in the editor.
     */
    public handleExecuteCommand(event: any): void {
        try {
            this.outputChannel.appendLine(`[Highlighter] Received event: ${JSON.stringify(event, (key, value) => {
                // Don't serialize large objects or circular references
                if (key === 'editor' || key === 'document') return '[TextEditor]';
                if (typeof value === 'function') return '[Function]';
                return value;
            }, 2).substring(0, 2000)}`);
            
            // Check if highlighting is enabled
            const config = vscode.workspace.getConfiguration('sqlDevCompanion');
            if (!config.get<boolean>('highlightExecutedStatement', true)) {
                this.outputChannel.appendLine('[Highlighter] Highlighting is disabled in settings');
                return;
            }
            
            // Only handle runStatement commands
            if (event.commandId !== 'sqldeveloper.worksheet.runStatement') {
                this.outputChannel.appendLine(`[Highlighter] Ignoring command: ${event.commandId}`);
                return;
            }
            
            const worksheet = event.worksheet;
            const result = event.result;
            
            if (!worksheet?.editor || !result?.data?.items?.length) {
                this.outputChannel.appendLine('[Highlighter] Missing worksheet editor or result items');
                return;
            }
            
            const editor = worksheet.editor as vscode.TextEditor;
            const items = result.data.items;
            
            // Get the first executed statement
            const statementInfo = items[0];
            const statementText = statementInfo.statementText;
            
            if (!statementText) {
                this.outputChannel.appendLine('[Highlighter] No statement text in result');
                return;
            }
            
            // Find the statement in the editor document
            const range = this.findStatementInEditor(editor, statementText);
            
            if (!range) {
                this.outputChannel.appendLine(`[Highlighter] Could not find statement in editor: ${statementText.substring(0, 50)}...`);
                return;
            }
            
            // Apply decoration
            this.highlightStatement(editor, range, statementText);
            
        } catch (error) {
            this.outputChannel.appendLine(`[Highlighter] Error: ${error}`);
        }
    }
    
    /**
     * Find the executed statement text in the editor document
     * Uses cursor position proximity to disambiguate multiple matches
     */
    private findStatementInEditor(editor: vscode.TextEditor, statementText: string): vscode.Range | undefined {
        const document = editor.document;
        const docText = document.getText();
        
        // Normalize the statement text for matching (handle line ending differences)
        const normalizedStatement = statementText.replace(/\r\n/g, '\n').trim();
        const normalizedDoc = docText.replace(/\r\n/g, '\n');
        
        // Find all occurrences
        const matches: { start: number; end: number }[] = [];
        let searchStart = 0;
        
        while (true) {
            const idx = normalizedDoc.indexOf(normalizedStatement, searchStart);
            if (idx === -1) break;
            matches.push({ start: idx, end: idx + normalizedStatement.length });
            searchStart = idx + 1;
        }
        
        if (matches.length === 0) {
            // Try case-insensitive match
            const lowerStatement = normalizedStatement.toLowerCase();
            const lowerDoc = normalizedDoc.toLowerCase();
            searchStart = 0;
            
            while (true) {
                const idx = lowerDoc.indexOf(lowerStatement, searchStart);
                if (idx === -1) break;
                matches.push({ start: idx, end: idx + normalizedStatement.length });
                searchStart = idx + 1;
            }
        }
        
        if (matches.length === 0) {
            return undefined;
        }
        
        // If multiple matches, pick the one closest to cursor
        let bestMatch = matches[0];
        if (matches.length > 1) {
            const cursorOffset = document.offsetAt(editor.selection.active);
            let minDistance = Math.abs(matches[0].start - cursorOffset);
            
            for (const match of matches) {
                const distance = Math.abs(match.start - cursorOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = match;
                }
            }
        }
        
        // Convert offsets back to positions (accounting for original line endings)
        // We need to map from normalized positions to actual document positions
        const startPos = this.offsetToPosition(docText, normalizedDoc, bestMatch.start);
        const endPos = this.offsetToPosition(docText, normalizedDoc, bestMatch.end);
        
        return new vscode.Range(startPos, endPos);
    }
    
    /**
     * Convert a position in normalized text to a position in the original document
     */
    private offsetToPosition(originalText: string, normalizedText: string, normalizedOffset: number): vscode.Position {
        // Count how many \r\n we've passed in the original up to this logical position
        let originalOffset = 0;
        let normalizedCounter = 0;
        
        while (normalizedCounter < normalizedOffset && originalOffset < originalText.length) {
            if (originalText[originalOffset] === '\r' && originalText[originalOffset + 1] === '\n') {
                // \r\n in original maps to \n in normalized (counts as 1)
                originalOffset += 2;
                normalizedCounter += 1;
            } else {
                originalOffset++;
                normalizedCounter++;
            }
        }
        
        // Now convert originalOffset to line/character
        let line = 0;
        let char = 0;
        for (let i = 0; i < originalOffset; i++) {
            if (originalText[i] === '\n') {
                line++;
                char = 0;
            } else if (originalText[i] === '\r') {
                // Skip \r in \r\n
            } else {
                char++;
            }
        }
        
        return new vscode.Position(line, char);
    }
    
    /**
     * Highlight a statement range in the editor
     */
    private highlightStatement(editor: vscode.TextEditor, range: vscode.Range, statementText?: string): void {
        const uri = editor.document.uri.toString();
        
        // Clear previous decoration for this document
        this.clearHighlightForDocument(uri);
        
        // Store and apply new decoration
        this.documentDecorations.set(uri, range);
        editor.setDecorations(this.decorationType, [range]);
        
        const preview = statementText 
            ? statementText.substring(0, 50) + (statementText.length > 50 ? '...' : '')
            : 'unknown';
        this.outputChannel.appendLine(`[Highlighter] Highlighted statement at lines ${range.start.line + 1}-${range.end.line + 1}: ${preview}`);
    }
    
    /**
     * Reapply decorations when editors become visible (e.g., after tab switch)
     */
    private reapplyDecorations(editors: readonly vscode.TextEditor[]): void {
        for (const editor of editors) {
            const uri = editor.document.uri.toString();
            const range = this.documentDecorations.get(uri);
            if (range) {
                editor.setDecorations(this.decorationType, [range]);
            }
        }
    }
    
    /**
     * Clear highlight for a specific document
     */
    private clearHighlightForDocument(uri: string): void {
        if (this.documentDecorations.has(uri)) {
            this.documentDecorations.delete(uri);
            // Find the editor for this document and clear its decoration
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
            if (editor) {
                editor.setDecorations(this.decorationType, []);
            }
        }
    }
    
    /**
     * Clear the current highlight (all documents)
     */
    public clearHighlight(): void {
        // Clear all decorations from visible editors
        for (const editor of vscode.window.visibleTextEditors) {
            const uri = editor.document.uri.toString();
            if (this.documentDecorations.has(uri)) {
                editor.setDecorations(this.decorationType, []);
            }
        }
        this.documentDecorations.clear();
    }
    
    /**
     * Clear highlight for a specific editor/document (used when new query runs on same worksheet)
     */
    public clearHighlightForEditor(editor: vscode.TextEditor): void {
        this.clearHighlightForDocument(editor.document.uri.toString());
    }
    
    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.clearHighlight();
        this.decorationType.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
