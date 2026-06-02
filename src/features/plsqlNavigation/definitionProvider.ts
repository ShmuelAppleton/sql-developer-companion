import * as vscode from 'vscode';
import { PlsqlParser } from './plsqlParser';
import { WorkspaceIndexer, WorkspaceDefinition } from './workspaceIndexer';

/**
 * Provides Go to Definition and Go to Implementation functionality for PL/SQL code
 * Searches both the current file and across the entire workspace
 */
export class PlsqlDefinitionProvider implements vscode.DefinitionProvider, vscode.ImplementationProvider {
    
    private parser: PlsqlParser;
    private outputChannel: vscode.OutputChannel;
    private workspaceIndexer: WorkspaceIndexer | undefined;
    
    constructor(outputChannel: vscode.OutputChannel, workspaceIndexer?: WorkspaceIndexer) {
        this.parser = new PlsqlParser();
        this.outputChannel = outputChannel;
        this.workspaceIndexer = workspaceIndexer;
    }
    
    /**
     * Set the workspace indexer (can be set after construction)
     */
    public setWorkspaceIndexer(indexer: WorkspaceIndexer): void {
        this.workspaceIndexer = indexer;
    }
    
    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        return this.findLocation(document, position, 'Definition');
    }
    
    public provideImplementation(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        return this.findLocation(document, position, 'Implementation');
    }
    
    private findLocation(
        document: vscode.TextDocument,
        position: vscode.Position,
        type: string
    ): vscode.ProviderResult<vscode.LocationLink[]> {
        
        const word = this.parser.getWordAtPosition(document, position);
        if (!word) {
            return undefined;
        }
        
        // Don't provide definition if we're inside a string literal
        if (this.isInsideString(document, position)) {
            return undefined;
        }
        
        // Check if there's a package prefix (e.g., PACKAGE_NAME.PROCEDURE_NAME)
        const packagePrefix = this.getPackagePrefix(document, position);
        
        this.outputChannel.appendLine(`[${type}] Looking for "${word}"${packagePrefix ? ` with prefix "${packagePrefix}"` : ''} at line ${position.line + 1}`);
        
        const locationLinks: vscode.LocationLink[] = [];
        const originRange = document.getWordRangeAtPosition(position, /\w+/);
        
        // 1. First, search in the current document
        const localDefinitions = this.parser.parseDocument(document);
        const localDef = this.parser.findDefinition(localDefinitions, word);
        
        if (localDef && position.line !== localDef.line) {
            locationLinks.push(this.createLocationLink(
                document.uri,
                localDef,
                originRange
            ));
            this.outputChannel.appendLine(`[${type}] Found local: ${localDef.type} "${localDef.name}" at line ${localDef.line + 1}`);
        }
        
        // 2. Search across workspace ONLY for local files (not dbtools:// server files)
        //    Only for procedures and functions (cursors, parameters, variables are local-only)
        const isLocalFile = document.uri.scheme === 'file';
        
        // Get configuration for package definition target
        const config = vscode.workspace.getConfiguration('sqlDevCompanion');
        const packageTarget = config.get<string>('packageDefinitionTarget', 'body');
        
        if (this.workspaceIndexer && isLocalFile) {
            // Get definitions from other files
            const workspaceDefs = this.workspaceIndexer.findDefinitionsExcludingFile(word, document.uri);
            
            for (const wsDef of workspaceDefs) {
                // Only include procedures, functions, tables, and packages for cross-file navigation
                // Skip cursors, parameters, variables, types as they're file-specific
                if (wsDef.type !== 'procedure' && wsDef.type !== 'function' && wsDef.type !== 'table' && wsDef.type !== 'package') {
                    continue;
                }
                
                // For package definitions, filter based on user preference (body/spec/both)
                if (wsDef.type === 'package') {
                    if (packageTarget === 'body' && wsDef.isPackageBody !== true) {
                        this.outputChannel.appendLine(`[${type}] Skipping package spec "${wsDef.name}" (config: body only)`);
                        continue;
                    }
                    if (packageTarget === 'spec' && wsDef.isPackageBody !== false) {
                        this.outputChannel.appendLine(`[${type}] Skipping package body "${wsDef.name}" (config: spec only)`);
                        continue;
                    }
                    // 'both' - no filtering
                }
                
                // For procedures/functions with a package prefix, filter by body/spec
                if ((wsDef.type === 'procedure' || wsDef.type === 'function') && packagePrefix) {
                    const filePackageNames = this.workspaceIndexer.getPackageNamesInFile(wsDef.uri);
                    const hasMatchingPackage = filePackageNames.some(
                        pkgName => pkgName.toLowerCase() === packagePrefix.toLowerCase()
                    );
                    if (!hasMatchingPackage) {
                        this.outputChannel.appendLine(`[${type}] Skipping ${wsDef.fileName} - no package definition matches prefix "${packagePrefix}"`);
                        continue;
                    }
                    
                    // Filter by the procedure/function's own isPackageBody flag
                    if (packageTarget === 'body' && wsDef.isPackageBody !== true) {
                        this.outputChannel.appendLine(`[${type}] Skipping spec declaration "${wsDef.name}" in ${wsDef.fileName} (config: body only)`);
                        continue;
                    }
                    if (packageTarget === 'spec' && wsDef.isPackageBody !== false) {
                        this.outputChannel.appendLine(`[${type}] Skipping body definition "${wsDef.name}" in ${wsDef.fileName} (config: spec only)`);
                        continue;
                    }
                }
                
                locationLinks.push(this.createLocationLinkFromWorkspace(wsDef, originRange));
                this.outputChannel.appendLine(`[${type}] Found in workspace: ${wsDef.type} "${wsDef.name}" in ${wsDef.fileName} at line ${wsDef.line + 1}`);
            }
        } else if (!isLocalFile) {
            this.outputChannel.appendLine(`[${type}] Skipping workspace search for dbtools file`);
        }
        
        if (locationLinks.length === 0) {
            return undefined;
        }
        
        this.outputChannel.appendLine(`[${type}] Returning ${locationLinks.length} definition(s)`);
        return locationLinks;
    }
    
    /**
     * Create a LocationLink from a local definition
     */
    private createLocationLink(
        uri: vscode.Uri,
        definition: { name: string; line: number; column: number },
        originRange: vscode.Range | undefined
    ): vscode.LocationLink {
        const targetStart = new vscode.Position(definition.line, definition.column);
        const targetEnd = new vscode.Position(definition.line, definition.column + definition.name.length);
        const targetRange = new vscode.Range(targetStart, targetEnd);
        
        return {
            originSelectionRange: originRange,
            targetUri: uri,
            targetRange: targetRange,
            targetSelectionRange: targetRange
        };
    }
    
    /**
     * Create a LocationLink from a workspace definition
     */
    private createLocationLinkFromWorkspace(
        definition: WorkspaceDefinition,
        originRange: vscode.Range | undefined
    ): vscode.LocationLink {
        const targetStart = new vscode.Position(definition.line, definition.column);
        const targetEnd = new vscode.Position(definition.line, definition.column + definition.name.length);
        const targetRange = new vscode.Range(targetStart, targetEnd);
        
        return {
            originSelectionRange: originRange,
            targetUri: definition.uri,
            targetRange: targetRange,
            targetSelectionRange: targetRange
        };
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
}
