import * as vscode from 'vscode';

/**
 * Represents a PL/SQL definition (cursor, procedure, function, package, table, or variable)
 */
export interface PlsqlDefinition {
    name: string;
    type: 'cursor' | 'procedure' | 'function' | 'variable' | 'parameter' | 'type' | 'table' | 'package';
    line: number;  // 0-based line number
    column: number;
    endLine?: number;
    signature: string;  // The signature (for proc/func: up to IS/AS, for cursor: full definition)
    snippet: string;    // Preview snippet for hover (limited lines for cursors)
    isPackageBody?: boolean;  // For packages/procs/funcs: true = body (has IS/AS), false = spec (ends with ;)
}

/**
 * Parser for PL/SQL code to extract definitions
 */
export class PlsqlParser {
    
    /**
     * Parse a document and return all definitions
     */
    public parseDocument(document: vscode.TextDocument): PlsqlDefinition[] {
        return this.parseText(document.getText());
    }
    
    /**
     * Parse raw text content and return all definitions
     */
    public parseText(text: string): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const lines = text.split(/\r?\n/);
        
        // Parse packages (spec and body)
        definitions.push(...this.parsePackages(lines));
        
        // Parse cursors
        definitions.push(...this.parseCursors(lines));
        
        // Parse procedures
        definitions.push(...this.parseProcedures(lines));
        
        // Parse functions
        definitions.push(...this.parseFunctions(lines));
        
        // Parse procedure/function parameters
        definitions.push(...this.parseParameters(lines));
        
        // Parse variables/constants
        definitions.push(...this.parseVariables(lines));
        
        // Parse types
        definitions.push(...this.parseTypes(lines));
        
        // Parse tables
        definitions.push(...this.parseTables(lines));
        
        // Deduplicate definitions (same name, type, and line)
        return this.deduplicateDefinitions(definitions);
    }
    
    /**
     * Remove duplicate definitions (same name, type, and line number)
     */
    private deduplicateDefinitions(definitions: PlsqlDefinition[]): PlsqlDefinition[] {
        const seen = new Set<string>();
        return definitions.filter(def => {
            const key = `${def.name.toLowerCase()}|${def.type}|${def.line}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }
    
    /**
     * Parse cursor definitions
     */
    private parseCursors(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const cursorPattern = /^\s*CURSOR\s+(\w+)\s*(\([^)]*\))?\s*(IS|AS)?/i;
        
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(cursorPattern);
            if (match) {
                const endLine = this.findCursorEnd(lines, i);
                const fullSnippet = this.getSnippet(lines, i, endLine, 100);
                const limitedSnippet = this.getSnippet(lines, i, endLine, 12);
                
                definitions.push({
                    name: match[1],
                    type: 'cursor',
                    line: i,
                    column: lines[i].toLowerCase().indexOf('cursor'),
                    endLine: endLine,
                    signature: fullSnippet,
                    snippet: limitedSnippet
                });
            }
        }
        
        return definitions;
    }
    
    /**
     * Find the end of a cursor definition
     */
    private findCursorEnd(lines: string[], startLine: number): number {
        let parenDepth = 0;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '(') parenDepth++;
                if (char === ')') parenDepth--;
            }
            
            if (line.includes(';') && parenDepth <= 0) {
                return i;
            }
        }
        
        return startLine;
    }
    
    /**
     * Parse procedure definitions (both body and spec declarations)
     */
    private parseProcedures(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const procPattern = /^\s*PROCEDURE\s+(\w+)/i;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(procPattern);
            if (match) {
                const signatureInfo = this.extractSignature(lines, i);
                if (signatureInfo.isDefinition) {
                    const endLine = signatureInfo.isBody 
                        ? this.findProcedureEnd(lines, i, match[1]) 
                        : i;  // Spec declarations end on same line or close by
                    definitions.push({
                        name: match[1],
                        type: 'procedure',
                        line: i,
                        column: line.toLowerCase().indexOf('procedure'),
                        endLine: endLine,
                        signature: signatureInfo.signature,
                        snippet: signatureInfo.signature,
                        isPackageBody: signatureInfo.isBody
                    });
                }
            }
        }
        
        return definitions;
    }
    
    /**
     * Parse function definitions (both body and spec declarations)
     */
    private parseFunctions(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const funcPattern = /^\s*FUNCTION\s+(\w+)/i;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(funcPattern);
            if (match) {
                const signatureInfo = this.extractSignature(lines, i);
                if (signatureInfo.isDefinition) {
                    const endLine = signatureInfo.isBody 
                        ? this.findFunctionEnd(lines, i, match[1]) 
                        : i;  // Spec declarations end on same line or close by
                    definitions.push({
                        name: match[1],
                        type: 'function',
                        line: i,
                        column: line.toLowerCase().indexOf('function'),
                        endLine: endLine,
                        signature: signatureInfo.signature,
                        snippet: signatureInfo.signature,
                        isPackageBody: signatureInfo.isBody
                    });
                }
            }
        }
        
        return definitions;
    }
    
    /**
     * Parse procedure/function parameters
     */
    private parseParameters(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const procFuncPattern = /^\s*(PROCEDURE|FUNCTION)\s+(\w+)\s*\(/i;
        
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(procFuncPattern);
            if (match) {
                // Collect parameter text (may span multiple lines until closing paren or IS/AS)
                let paramText = '';
                let parenDepth = 0;
                let startedParams = false;
                
                for (let j = i; j < Math.min(i + 30, lines.length); j++) {
                    const line = lines[j];
                    
                    for (let k = 0; k < line.length; k++) {
                        const char = line[k];
                        if (char === '(') {
                            if (startedParams) {
                                parenDepth++;
                                paramText += char;
                            } else {
                                startedParams = true;
                                parenDepth = 1;
                            }
                        } else if (char === ')') {
                            parenDepth--;
                            if (parenDepth === 0) {
                                // Found end of parameters - now parse them
                                const params = this.extractParams(paramText, lines, i);
                                definitions.push(...params);
                                break;
                            }
                            paramText += char;
                        } else if (startedParams && parenDepth > 0) {
                            paramText += char;
                        }
                    }
                    
                    if (parenDepth === 0 && startedParams) break;
                    if (startedParams && parenDepth > 0) paramText += ' ';
                }
            }
        }
        
        return definitions;
    }
    
    /**
     * Extract individual parameters from parameter text
     */
    private extractParams(paramText: string, lines: string[], procLine: number): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        
        // Split by comma, but respect parentheses (for DEFAULT values with function calls)
        const params: string[] = [];
        let current = '';
        let depth = 0;
        
        for (const char of paramText) {
            if (char === '(') depth++;
            if (char === ')') depth--;
            if (char === ',' && depth === 0) {
                params.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) params.push(current.trim());
        
        // Parse each parameter: name [IN|OUT|IN OUT] type [DEFAULT value]
        const paramPattern = /^(\w+)\s+(?:(IN\s+OUT|IN|OUT)\s+)?(\w+(?:\s*\([^)]*\))?(?:\.\w+)?(?:%(?:TYPE|ROWTYPE))?)/i;
        
        for (const param of params) {
            const match = param.match(paramPattern);
            if (match) {
                const paramName = match[1];
                const direction = match[2] || 'IN';
                const paramType = match[3];
                
                // Find the line where this parameter appears
                let paramLine = procLine;
                let paramCol = 0;
                const paramNameLower = paramName.toLowerCase();
                
                for (let j = procLine; j < Math.min(procLine + 15, lines.length); j++) {
                    const lineText = lines[j].toLowerCase();
                    const idx = lineText.search(new RegExp(`\\b${paramNameLower}\\b`));
                    if (idx >= 0) {
                        paramLine = j;
                        paramCol = idx;
                        break;
                    }
                }
                
                const signature = `${paramName} ${direction} ${paramType}`.replace(/\s+/g, ' ');
                
                definitions.push({
                    name: paramName,
                    type: 'parameter',
                    line: paramLine,
                    column: paramCol,
                    signature: signature,
                    snippet: signature
                });
            }
        }
        
        return definitions;
    }

    /**
     * Extract signature from procedure/function definition (up to IS/AS keyword or semicolon)
     * Returns isBody=true for body definitions (with IS/AS), isBody=false for spec declarations
     */
    private extractSignature(lines: string[], startLine: number): { signature: string; isDefinition: boolean; isBody: boolean } {
        const signatureLines: string[] = [];
        let foundIsAs = false;
        let foundSemicolon = false;
        let parenDepth = 0;
        
        for (let i = startLine; i < Math.min(startLine + 30, lines.length); i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '(') parenDepth++;
                if (char === ')') parenDepth--;
            }
            
            // Check for IS/AS keyword outside of parentheses
            if (parenDepth <= 0) {
                const isAsMatch = line.match(/\b(IS|AS)\s*$/i) || 
                                  line.match(/\)\s*(IS|AS)\s*$/i) ||
                                  line.match(/\b(IS|AS)\s*--/i);
                
                if (isAsMatch) {
                    const trimmedLine = line.replace(/\s*--.*$/, '').trimEnd();
                    signatureLines.push(trimmedLine);
                    foundIsAs = true;
                    break;
                }
            }
            
            // Check for semicolon (forward declaration or spec) outside parens
            if (line.includes(';') && parenDepth <= 0) {
                signatureLines.push(line.replace(/;.*$/, '').trimEnd());
                foundSemicolon = true;
                break;
            }
            
            signatureLines.push(line);
        }
        
        return {
            signature: signatureLines.join('\n').trim(),
            isDefinition: foundIsAs || foundSemicolon,  // Both body and spec are valid definitions
            isBody: foundIsAs  // Only true if it has IS/AS (body implementation)
        };
    }
    
    /**
     * Parse variable declarations
     */
    private parseVariables(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        // Match variable declarations with types like: VARCHAR2(100), NUMBER(15,2), CLOB, table.column%TYPE
        const varPattern = /^\s*(\w+)\s+(\w+(?:\s*\([^)]*\))?(?:\.\w+)?(?:%(?:TYPE|ROWTYPE))?)\s*(:=|DEFAULT|;)/i;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(BEGIN|END|IF|ELSE|ELSIF|LOOP|FOR|WHILE|CASE|WHEN|THEN|RETURN|EXCEPTION|CURSOR|PROCEDURE|FUNCTION|TYPE|OPEN|CLOSE|FETCH)/i.test(line)) {
                continue;
            }
            
            const match = line.match(varPattern);
            if (match) {
                const name = match[1].toUpperCase();
                if (!['BEGIN', 'END', 'IF', 'THEN', 'ELSE', 'LOOP', 'RETURN', 'IS', 'AS', 'IN', 'OUT', 'NULL', 'NOT', 'AND', 'OR'].includes(name)) {
                    const col = line.search(/\S/);
                    definitions.push({
                        name: match[1],
                        type: 'variable',
                        line: i,
                        column: col >= 0 ? col : 0,
                        signature: line.trim().replace(/;.*$/, ';'),
                        snippet: line.trim().replace(/;.*$/, ';')
                    });
                }
            }
        }
        
        return definitions;
    }
    
    /**
     * Parse TYPE declarations
     */
    private parseTypes(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        const typePattern = /^\s*TYPE\s+(\w+)\s+IS\s+(TABLE|RECORD|REF\s+CURSOR|VARRAY)/i;
        
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(typePattern);
            if (match) {
                const endLine = this.findBlockEnd(lines, i, ';');
                const snippet = this.getSnippet(lines, i, endLine, 10);
                definitions.push({
                    name: match[1],
                    type: 'type',
                    line: i,
                    column: lines[i].toLowerCase().indexOf('type'),
                    endLine: endLine,
                    signature: snippet,
                    snippet: snippet
                });
            }
        }
        
        return definitions;
    }
    
    /**
     * Parse PACKAGE and PACKAGE BODY declarations
     * Handles: CREATE [OR REPLACE] [EDITIONABLE|NONEDITIONABLE] PACKAGE [BODY] [schema.]package_name
     */
    private parsePackages(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        // Match CREATE [OR REPLACE] [EDITIONABLE] PACKAGE [BODY] with optional quoted schema.name
        // Examples:
        //   CREATE OR REPLACE EDITIONABLE PACKAGE BODY "NTLAURA"."BPM_EMAIL_PKG" AS
        //   CREATE PACKAGE my_package AS
        //   PACKAGE BODY my_package IS
        const packagePattern = /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?)?PACKAGE\s+(?:BODY\s+)?(?:"?[\w]+\"?\s*\.\s*)?\"?(\w+)\"?/i;
        
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(packagePattern);
            if (match) {
                const packageName = match[1];
                // Check if it's a body or spec
                const isBody = /\bPACKAGE\s+BODY\b/i.test(lines[i]);
                
                // Find the end of the package
                const endLine = this.findPackageEnd(lines, i, packageName);
                const snippet = this.getSnippet(lines, i, Math.min(i + 5, endLine), 6);
                
                definitions.push({
                    name: packageName,
                    type: 'package',
                    line: i,
                    column: lines[i].toLowerCase().indexOf('package'),
                    endLine: endLine,
                    signature: `${isBody ? 'PACKAGE BODY' : 'PACKAGE'} ${packageName}`,
                    snippet: snippet,
                    isPackageBody: isBody
                });
            }
        }
        
        return definitions;
    }
    
    /**
     * Find the end of a package definition
     */
    private findPackageEnd(lines: string[], startLine: number, packageName: string): number {
        const endPattern = new RegExp(`^\\s*END\\s+(${packageName})?\\s*;`, 'i');
        
        for (let i = startLine + 1; i < lines.length; i++) {
            if (endPattern.test(lines[i])) {
                return i;
            }
        }
        
        return lines.length - 1;
    }

    /**
     * Parse CREATE TABLE statements
     * Handles: CREATE TABLE schema.table_name or CREATE TABLE table_name
     */
    private parseTables(lines: string[]): PlsqlDefinition[] {
        const definitions: PlsqlDefinition[] = [];
        // Match CREATE TABLE with optional schema prefix and quoted/unquoted names
        const tablePattern = /^\s*CREATE\s+TABLE\s+(?:"?[\w]+\"?\s*\.\s*)?"?(\w+)"?\s*/i;
        
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(tablePattern);
            if (match) {
                const tableName = match[1];
                // Find end of CREATE TABLE (ends with ; possibly after many lines)
                const endLine = this.findTableEnd(lines, i);
                const snippet = this.getSnippet(lines, i, endLine, 15);
                
                definitions.push({
                    name: tableName,
                    type: 'table',
                    line: i,
                    column: lines[i].toLowerCase().indexOf('table'),
                    endLine: endLine,
                    signature: snippet,
                    snippet: snippet
                });
            }
        }
        
        return definitions;
    }
    
    /**
     * Find the end of a CREATE TABLE statement
     */
    private findTableEnd(lines: string[], startLine: number): number {
        let parenDepth = 0;
        let foundOpenParen = false;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '(') {
                    parenDepth++;
                    foundOpenParen = true;
                }
                if (char === ')') {
                    parenDepth--;
                }
            }
            
            // Table definition ends with ; after closing paren
            if (foundOpenParen && parenDepth === 0 && line.includes(';')) {
                return i;
            }
            // Some tables end with ; on same line without complex structure
            if (!foundOpenParen && line.includes(';')) {
                return i;
            }
        }
        
        return Math.min(startLine + 20, lines.length - 1);
    }

    private findProcedureEnd(lines: string[], startLine: number, name: string): number {
        const endPattern = new RegExp(`^\\s*END\\s+(${name})?\\s*;`, 'i');
        let depth = 0;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            if (/\bBEGIN\b/i.test(line)) depth++;
            
            if (/\bEND\b/i.test(line)) {
                if (depth <= 1 && endPattern.test(line)) return i;
                if (depth > 0) depth--;
            }
        }
        
        return startLine + 10;
    }
    
    private findFunctionEnd(lines: string[], startLine: number, name: string): number {
        return this.findProcedureEnd(lines, startLine, name);
    }
    
    private findBlockEnd(lines: string[], startLine: number, terminator: string): number {
        for (let i = startLine; i < lines.length; i++) {
            if (lines[i].includes(terminator)) return i;
        }
        return startLine;
    }
    
    private getSnippet(lines: string[], startLine: number, endLine?: number, maxLines: number = 10): string {
        const end = endLine !== undefined 
            ? Math.min(endLine + 1, startLine + maxLines) 
            : startLine + maxLines;
        const snippetLines = lines.slice(startLine, Math.min(end, lines.length));
        let snippet = snippetLines.join('\n');
        
        if (end < lines.length && (endLine === undefined || end < endLine + 1)) {
            snippet += '\n...';
        }
        
        return snippet;
    }
    
    public findDefinition(definitions: PlsqlDefinition[], name: string): PlsqlDefinition | undefined {
        const lowerName = name.toLowerCase();
        return definitions.find(def => def.name.toLowerCase() === lowerName);
    }
    
    public getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position, /\w+/);
        if (wordRange) {
            return document.getText(wordRange);
        }
        return undefined;
    }
}
