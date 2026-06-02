import * as vscode from 'vscode';
import { PlsqlParser, PlsqlDefinition } from './plsqlParser';

/**
 * Represents a definition with its source file
 */
export interface WorkspaceDefinition extends PlsqlDefinition {
    uri: vscode.Uri;
    fileName: string;
}

/**
 * Indexes all PL/SQL definitions across the workspace
 * Provides fast lookup by symbol name
 */
export class WorkspaceIndexer {
    
    private parser: PlsqlParser;
    private outputChannel: vscode.OutputChannel;
    
    // Map of symbol name (lowercase) -> array of definitions
    private definitionIndex: Map<string, WorkspaceDefinition[]> = new Map();
    
    // Map of file URI -> definitions in that file (for quick invalidation)
    private fileIndex: Map<string, WorkspaceDefinition[]> = new Map();
    
    // File patterns to index
    private readonly FILE_PATTERNS = '**/*.{pks,pkb,sql,pls,plb,pck}';
    
    private isIndexing = false;
    private indexedFileCount = 0;
    private disposed = false;
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.parser = new PlsqlParser();
        this.outputChannel = outputChannel;
    }
    
    /**
     * Mark the indexer as disposed - stops any ongoing indexing
     */
    public dispose(): void {
        this.disposed = true;
    }
    
    /**
     * Initialize the indexer - scan all workspace files
     */
    public async initialize(): Promise<void> {
        if (this.disposed) {
            return;
        }
        
        this.outputChannel.appendLine('[Indexer] Starting workspace indexing...');
        this.isIndexing = true;
        
        const startTime = Date.now();
        
        try {
            // Find all PL/SQL files in workspace
            const files = await vscode.workspace.findFiles(this.FILE_PATTERNS, '**/node_modules/**');
            
            if (this.disposed) {
                return;
            }
            
            this.outputChannel.appendLine(`[Indexer] Found ${files.length} PL/SQL files to index`);
            
            // Index files sequentially with error handling for each file
            for (const file of files) {
                if (this.disposed) {
                    break;
                }
                
                try {
                    await this.indexFile(file);
                } catch (error) {
                    // Silently continue on individual file errors
                }
            }
            
            const elapsed = Date.now() - startTime;
            if (!this.disposed) {
                this.outputChannel.appendLine(`[Indexer] Indexed ${this.indexedFileCount} files with ${this.definitionIndex.size} unique symbols in ${elapsed}ms`);
            }
            
        } catch (error) {
            // Silently ignore errors during shutdown
        } finally {
            this.isIndexing = false;
        }
    }
    
    /**
     * Index a single file
     */
    public async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            // Read file content directly instead of opening as document
            // This avoids "Canceled" errors from openTextDocument
            let fileContent: Uint8Array;
            try {
                fileContent = await vscode.workspace.fs.readFile(uri);
            } catch (readError) {
                // File might not exist, be locked, or operation canceled - skip silently
                return;
            }
            
            const text = Buffer.from(fileContent).toString('utf8');
            
            // Remove old definitions from this file
            this.removeFileFromIndex(uri.toString());
            
            // Parse the file content
            const definitions = this.parser.parseText(text);
            
            if (definitions.length === 0) {
                return;
            }
            
            const fileName = uri.path.split('/').pop() || uri.fsPath;
            const workspaceDefinitions: WorkspaceDefinition[] = [];
            
            // Add each definition to the index
            for (const def of definitions) {
                const workspaceDef: WorkspaceDefinition = {
                    ...def,
                    uri: uri,
                    fileName: fileName
                };
                
                workspaceDefinitions.push(workspaceDef);
                
                // Add to definition index (by lowercase name)
                const key = def.name.toLowerCase();
                const existing = this.definitionIndex.get(key) || [];
                existing.push(workspaceDef);
                this.definitionIndex.set(key, existing);
            }
            
            // Store in file index
            this.fileIndex.set(uri.toString(), workspaceDefinitions);
            this.indexedFileCount++;
            
        } catch (error) {
            // Silently ignore any errors during indexing
        }
    }
    
    /**
     * Remove all definitions from a file
     */
    public removeFileFromIndex(uriString: string): void {
        const fileDefs = this.fileIndex.get(uriString);
        if (!fileDefs) {
            return;
        }
        
        // Remove each definition from the main index
        for (const def of fileDefs) {
            const key = def.name.toLowerCase();
            const existing = this.definitionIndex.get(key);
            if (existing) {
                const filtered = existing.filter(d => d.uri.toString() !== uriString);
                if (filtered.length > 0) {
                    this.definitionIndex.set(key, filtered);
                } else {
                    this.definitionIndex.delete(key);
                }
            }
        }
        
        this.fileIndex.delete(uriString);
    }
    
    /**
     * Find all definitions for a symbol name across the workspace
     */
    public findDefinitions(symbolName: string): WorkspaceDefinition[] {
        const key = symbolName.toLowerCase();
        return this.definitionIndex.get(key) || [];
    }
    
    /**
     * Find definitions excluding a specific file (for cross-file navigation)
     * Uses fsPath for comparison to handle URI format differences
     */
    public findDefinitionsExcludingFile(symbolName: string, excludeUri: vscode.Uri): WorkspaceDefinition[] {
        const all = this.findDefinitions(symbolName);
        const excludePath = excludeUri.fsPath.toLowerCase();
        return all.filter(def => def.uri.fsPath.toLowerCase() !== excludePath);
    }
    
    /**
     * Find definitions in a specific file
     */
    public findDefinitionsInFile(symbolName: string, uri: vscode.Uri): WorkspaceDefinition[] {
        const all = this.findDefinitions(symbolName);
        return all.filter(def => def.uri.toString() === uri.toString());
    }
    
    /**
     * Get all package names defined in a specific file
     * Returns package names from actual PACKAGE/PACKAGE BODY definitions
     */
    public getPackageNamesInFile(uri: vscode.Uri): string[] {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return [];
        }
        
        return fileDefs
            .filter(def => def.type === 'package')
            .map(def => def.name.toUpperCase());
    }
    
    /**
     * Check if a file contains a package body for the given package name
     */
    public isPackageBodyFile(uri: vscode.Uri, packageName: string): boolean {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return false;
        }
        
        return fileDefs.some(def => 
            def.type === 'package' && 
            def.name.toLowerCase() === packageName.toLowerCase() &&
            def.isPackageBody === true
        );
    }
    
    /**
     * Check if a file contains a package spec for the given package name
     */
    public isPackageSpecFile(uri: vscode.Uri, packageName: string): boolean {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return false;
        }
        
        return fileDefs.some(def => 
            def.type === 'package' && 
            def.name.toLowerCase() === packageName.toLowerCase() &&
            def.isPackageBody === false
        );
    }
    
    /**
     * Get statistics about the index
     */
    public getStats(): { fileCount: number; symbolCount: number; isIndexing: boolean } {
        return {
            fileCount: this.fileIndex.size,
            symbolCount: this.definitionIndex.size,
            isIndexing: this.isIndexing
        };
    }
    
    /**
     * Clear the entire index
     */
    public clear(): void {
        this.definitionIndex.clear();
        this.fileIndex.clear();
        this.indexedFileCount = 0;
    }
    
    /**
     * Set up file watchers to keep index up to date
     */
    public setupFileWatchers(context: vscode.ExtensionContext): void {
        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher(this.FILE_PATTERNS);
        
        watcher.onDidCreate(async (uri) => {
            this.outputChannel.appendLine(`[Indexer] File created: ${uri.fsPath}`);
            await this.indexFile(uri);
        });
        
        watcher.onDidChange(async (uri) => {
            this.outputChannel.appendLine(`[Indexer] File changed: ${uri.fsPath}`);
            await this.indexFile(uri);
        });
        
        watcher.onDidDelete((uri) => {
            this.outputChannel.appendLine(`[Indexer] File deleted: ${uri.fsPath}`);
            this.removeFileFromIndex(uri.toString());
        });
        
        context.subscriptions.push(watcher);
        
        // Also watch for document saves (in case file watcher misses it)
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (this.isPlsqlFile(document.uri)) {
                    this.outputChannel.appendLine(`[Indexer] Document saved: ${document.uri.fsPath}`);
                    await this.indexFile(document.uri);
                }
            })
        );
    }
    
    /**
     * Check if a URI is a PL/SQL file
     */
    private isPlsqlFile(uri: vscode.Uri): boolean {
        const ext = uri.fsPath.toLowerCase();
        return ext.endsWith('.pks') || 
               ext.endsWith('.pkb') || 
               ext.endsWith('.sql') || 
               ext.endsWith('.pls') || 
               ext.endsWith('.plb') ||
               ext.endsWith('.pck');
    }
}
