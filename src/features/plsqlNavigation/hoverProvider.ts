import * as vscode from 'vscode';
import { PlsqlParser, PlsqlDefinition } from './plsqlParser';
import { WorkspaceIndexer, WorkspaceDefinition } from './workspaceIndexer';

/**
 * Provides hover tooltips for PL/SQL code
 * Shows signatures for procedures/functions and content for cursors
 * Searches both current file and workspace for cross-file definitions
 */
export class PlsqlHoverProvider implements vscode.HoverProvider {
    
    private parser: PlsqlParser;
    private outputChannel: vscode.OutputChannel;
    private workspaceIndexer: WorkspaceIndexer | undefined;
    
    constructor(outputChannel: vscode.OutputChannel, workspaceIndexer?: WorkspaceIndexer) {
        this.parser = new PlsqlParser();
        this.outputChannel = outputChannel;
        this.workspaceIndexer = workspaceIndexer;
    }
    
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        
        const word = this.parser.getWordAtPosition(document, position);
        if (!word) {
            return undefined;
        }
        
        // Don't show hover if we're inside a string literal
        if (this.isInsideString(document, position)) {
            return undefined;
        }
        
        // Check if there's a package prefix (e.g., flow_globals.process_id)
        const packagePrefix = this.getPackagePrefix(document, position);
        
        let definition: PlsqlDefinition | WorkspaceDefinition | undefined;
        let isFromWorkspace = false;
        let sourceFile: string | undefined;
        
        // Get configuration for package definition target
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const packageTarget = config.get<string>('packageDefinitionTarget', 'body');
        
        // If there's a package prefix, ONLY look in that package (not locally)
        if (packagePrefix) {
            // Only search workspace for the specific package
            if (this.workspaceIndexer) {
                const workspaceDefs = this.workspaceIndexer.findDefinitions(word);
                
                // Filter to only definitions in the specified package
                const filteredDefs = workspaceDefs.filter(wsDef => {
                    const filePackageNames = this.workspaceIndexer!.getPackageNamesInFile(wsDef.uri);
                    const hasMatchingPackage = filePackageNames.some(
                        pkgName => pkgName.toLowerCase() === packagePrefix.toLowerCase()
                    );
                    if (!hasMatchingPackage) {
                        return false;
                    }
                    
                    // For procedures/functions, also filter by body/spec preference
                    if (wsDef.type === 'procedure' || wsDef.type === 'function') {
                        if (packageTarget === 'body' && wsDef.isPackageBody !== true) {
                            return false;
                        }
                        if (packageTarget === 'spec' && wsDef.isPackageBody !== false) {
                            return false;
                        }
                    }
                    
                    return true;
                });
                
                if (filteredDefs.length > 0) {
                    definition = filteredDefs[0];
                    isFromWorkspace = true;
                    sourceFile = filteredDefs[0].fileName;
                    this.outputChannel.appendLine(`[Hover] Found "${packagePrefix}.${word}" in workspace: ${sourceFile}`);
                }
            }
        } else {
            // No package prefix - first try to find in current document
            const localDefinitions = this.parser.parseDocument(document);
            definition = this.parser.findDefinition(localDefinitions, word);
            
            // If not found locally, search workspace (only for local files)
            if (!definition && this.workspaceIndexer && document.uri.scheme === 'file') {
                const workspaceDefs = this.workspaceIndexer.findDefinitions(word);
                
                // Filter workspace definitions based on package target setting
                const filteredDefs = workspaceDefs.filter(wsDef => {
                    // For package definitions, filter by body/spec preference
                    if (wsDef.type === 'package') {
                        if (packageTarget === 'body' && wsDef.isPackageBody !== true) {
                            return false;
                        }
                        if (packageTarget === 'spec' && wsDef.isPackageBody !== false) {
                            return false;
                        }
                    }
                    return true;
                });
                
                if (filteredDefs.length > 0) {
                    definition = filteredDefs[0];
                    isFromWorkspace = true;
                    sourceFile = filteredDefs[0].fileName;
                    this.outputChannel.appendLine(`[Hover] Found "${word}" in workspace: ${sourceFile}`);
                }
            }
        }
        
        if (!definition) {
            return undefined;
        }
        
        // Don't show hover if we're at the definition itself (only for local definitions)
        if (!isFromWorkspace && position.line === definition.line) {
            return undefined;
        }
        
        this.outputChannel.appendLine(`[Hover] Showing hover for ${definition.type} "${definition.name}" at line ${definition.line + 1}${isFromWorkspace ? ` (from ${sourceFile})` : ''}`);
        
        const markdown = this.createHoverContent(definition, isFromWorkspace, sourceFile);
        const wordRange = document.getWordRangeAtPosition(position, /\w+/);
        
        return new vscode.Hover(markdown, wordRange);
    }
    
    /**
     * Check if position is inside a string literal (single quotes)
     */
    private isInsideString(document: vscode.TextDocument, position: vscode.Position): boolean {
        const line = document.lineAt(position.line).text;
        const textBefore = line.substring(0, position.character);
        
        // Count single quotes before the position
        // If odd number, we're inside a string
        let quoteCount = 0;
        let i = 0;
        while (i < textBefore.length) {
            if (textBefore[i] === "'") {
                // Check for escaped quote ('')
                if (i + 1 < textBefore.length && textBefore[i + 1] === "'") {
                    i += 2; // Skip escaped quote
                    continue;
                }
                quoteCount++;
            }
            i++;
        }
        
        return quoteCount % 2 === 1;
    }
    
    /**
     * Extract package prefix from a qualified reference like "PACKAGE_NAME.PROCEDURE_NAME"
     * Returns the package prefix if the word at position is after a dot, undefined otherwise.
     */
    private getPackagePrefix(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_$#]*/);
        
        if (!wordRange) {
            return undefined;
        }
        
        // Check if there's a dot immediately before the word
        const charBeforeWord = wordRange.start.character > 0 
            ? line.charAt(wordRange.start.character - 1) 
            : '';
            
        if (charBeforeWord !== '.') {
            return undefined;
        }
        
        // Find the word before the dot (the package prefix)
        const textBeforeDot = line.substring(0, wordRange.start.character - 1);
        const prefixMatch = textBeforeDot.match(/([A-Za-z_][A-Za-z0-9_$#]*)$/);
        
        if (prefixMatch) {
            return prefixMatch[1].toUpperCase();
        }
        
        return undefined;
    }
    
    /**
     * Create hover content based on definition type
     */
    private createHoverContent(definition: PlsqlDefinition, isFromWorkspace: boolean = false, sourceFile?: string): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;
        
        const typeLabel = this.getTypeLabel(definition.type);
        const lineLink = `Go to line ${definition.line + 1}`;
        
        markdown.appendMarkdown(`**${typeLabel}** \`${definition.name}\`\n\n`);
        
        // For procedures and functions, show only the signature
        // For cursors and tables, show the full content (limited)
        const content = (definition.type === 'procedure' || definition.type === 'function') 
            ? definition.signature 
            : definition.snippet;
        
        markdown.appendCodeblock(content, 'sql');
        
        // Add source file info for workspace definitions
        if (isFromWorkspace && sourceFile) {
            markdown.appendMarkdown(`\n*From: ${sourceFile} (Line ${definition.line + 1})*`);
        } else {
            markdown.appendMarkdown(`\n*Line ${definition.line + 1}*`);
        }
        
        return markdown;
    }
    
    private getTypeLabel(type: string): string {
        switch (type) {
            case 'cursor':
                return '📋 Cursor';
            case 'procedure':
                return '⚙️ Procedure';
            case 'function':
                return '🔧 Function';
            case 'variable':
                return '📦 Variable';
            case 'parameter':
                return '📥 Parameter';
            case 'type':
                return '📐 Type';
            case 'table':
                return '🗃️ Table';
            case 'package':
                return '📦 Package';
            default:
                return '📄 Definition';
        }
    }
}
