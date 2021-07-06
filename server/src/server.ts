/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	InsertTextFormat,
	SignatureHelp,
	Position,
	ParameterInformation,
	MarkupContent,
	FormattingOptions,
	DidOpenTextDocumentParams,
	TextDocumentChangeEvent,
	TextDocumentSyncKind,
	DocumentSymbol,
	SymbolKind,
	Location,
	HandlerResult,
	SemanticTokensParams,
	SemanticTokens,
	SemanticTokensBuilder,
	SemanticTokensLegend,
	SemanticTokensRangeParams,
	SemanticTokensDeltaParams,
	DocumentSymbolParams,
	integer,
	DeclarationParams,
	LocationLink,
	DeclarationLink,
	Range,
	WorkspaceFolder,
	InitializedParams
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import { Stack } from './datastructs';
import { time } from 'console';

enum CommandParameterKind {
	Required, Default, Optional
}

type CommandParameter = { name: string, kind: CommandParameterKind, default: string};
// TypeScript type for caching the script command intelliSense
type Command = { documentation?: string, detail?: string, kind?: CompletionItemKind, insertText?: string, parameters?: CommandParameter[]};

type ConstantSymbol = {position: Position, name: string, resolution: string};

type SectionSymbol = {position: Position, name: string};

type PoryscriptSymbolCollection = {scripts: Array<SectionSymbol>, mapScripts: Array<SectionSymbol>, movementScripts: Array<SectionSymbol>, textSections: Array<SectionSymbol>};

type SemanticHighlightedRange = {start: number, len: number, tokenType: number, tokenClass: number};

type SettingsTokenInclude = {expression: string, type: string, file: string};

type PoryscriptIncludedToken = {position: Position, name: string, type: string, value?: string};

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let workspaceFolders : Array<WorkspaceFolder>;

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;
	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);
	if(hasWorkspaceFolderCapability && params.workspaceFolders)
		workspaceFolders = params.workspaceFolders;
	
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			},
			signatureHelpProvider: {
				triggerCharacters: ['(', ',']
			},
			semanticTokensProvider: {
				full: true,
				range: true,
				legend: {
					tokenTypes: ["keyword", "function", "enumMember", "variable"],
					tokenModifiers: []
				}
			}
		}
	};
});

connection.languages.semanticTokens.on(async (params : SemanticTokensParams) => {
	let builder = new SemanticTokensBuilder();
	let document = documents.get(params.textDocument.uri);
	if(!document)
		return builder.build();
	
	let lines = document.getText().split(/\r?\n/);
	return await parseSemanticTokens(lines, builder, document.uri);
});

connection.languages.semanticTokens.onRange(async (params : SemanticTokensRangeParams) => {
	let builder = new SemanticTokensBuilder();
	let document = documents.get(params.textDocument.uri);
	if(!document)
		return builder.build();
	let lines = document.getText(params.range).split(/\r?\n/);
	return await parseSemanticTokens(lines, builder, document.uri);
});

function isWhitespaceOrParenthesis(char:string) : boolean
{
	return (char === '(' || char === ')' || isWhitespace(char));
}

function isWhitespace(char:string) : boolean
{
	return (char === '\t' || char === ' ' || char === '\r' || char === '\n' || char === undefined)
}

function isWhitespaceCommaOrParenthesis(char:string) : boolean
{
	return isWhitespaceOrParenthesis(char) || char === ',';
}

function isFullSymbol(line:string, index: number, key:string) : boolean
{
	if(isWhitespaceCommaOrParenthesis(line[index + key.length]))
	{
		return (index == 0 || isWhitespaceCommaOrParenthesis(line[index-1]))
	}
	return false;
}

function isSingleSymbol(line:string, index:number, key:string) : boolean
{
	if(isWhitespaceOrParenthesis(line[index + key.length]))
	{
		return (index == 0 || isWhitespace(line[index-1]));
	}
	return false;
}

function isInCommentOrString(line:string, index:number, key:string) : boolean
{
	let slashComment = line.indexOf("//");
	let hashComment = line.indexOf("#");
	let preStringQuote = line.indexOf("\"");
	let postStringQuote = line.indexOf("\"", index + key.length);
	if(slashComment != -1 && slashComment < index)
		return true;
	if(hashComment != -1 && hashComment < index)
		return true;
	if(preStringQuote != -1 && preStringQuote < index && postStringQuote != -1 && postStringQuote > (index + key.length))
		return true;
	return false;
}

async function parseSemanticTokens(lines:Array<string>, builder:SemanticTokensBuilder, resource:string) {
	let commands = await getOrScanDocumentCommands(resource);
	let constants = await documentConstants.get(resource);
	let symbolMap = await generateGlobalSymbolTable();
	let scriptSymbols = symbolMap.flatMap((sym) => sym.scripts);
	let movementSymbols = symbolMap.flatMap((sym) => sym.movementScripts);
	let mapscriptSymbols = symbolMap.flatMap((sym) => sym.mapScripts);
	let textSymbols = symbolMap.flatMap((sym) => sym.textSections);
	let includedTokens = await generateGlobalIncludedTokensTable();

	for(let i = 0; i < lines.length; ++i) {
		let foundTokens: Array<SemanticHighlightedRange> = new Array<SemanticHighlightedRange>();
		commands.forEach((value: Command, key: string) => {
			//those are logic keywords in the language but also typically defined script commands, kind of a hacky workaround here
			//to just ignore them
			if(key !== "switch" && key !== "case") {
				if(value.kind == CompletionItemKind.Function) {
					let index = lines[i].indexOf(key);
					if(index != -1 && isSingleSymbol(lines[i], index, key) && !isInCommentOrString(lines[i], index, key)) {
						if(value.parameters && value.parameters.length > 0)
							foundTokens.push({start: index, len: key.length, tokenType: 1, tokenClass: 0});
						else
							foundTokens.push({start: index, len: key.length, tokenType: 0, tokenClass: 0});
					}
				}
				else if(value.kind == CompletionItemKind.Constant) {
					let index = lines[i].indexOf(key);
					if(index != -1 && isFullSymbol(lines[i], index, key) && !isInCommentOrString(lines[i], index, key))
						foundTokens.push({start: index, len: key.length, tokenType: 2, tokenClass: 0});
				}
			}
		});
		if(constants) {
			constants.forEach((value: ConstantSymbol, key: string) => {
				if(value.position.line != i) {
					let index = lines[i].indexOf(value.name);
					if(index != -1 && isFullSymbol(lines[i], index, key) && !isInCommentOrString(lines[i], index, key)) {
						foundTokens.push({start: index, len: value.name.length, tokenType: 2, tokenClass: 0});
					}
				}
			});
		}
		scriptSymbols.forEach(symbol => {
			if(symbol.position.line != i) {
				let index = lines[i].indexOf(symbol.name);
				if(index != -1 && isFullSymbol(lines[i], index, symbol.name) && !isInCommentOrString(lines[i], index, symbol.name)) {
					foundTokens.push({start: index, len: symbol.name.length, tokenType: 1, tokenClass: 0});
				}
			}
		});
		mapscriptSymbols.forEach(symbol => {
			if(symbol.position.line != i) {
				let index = lines[i].indexOf(symbol.name);
				if(index != -1 && isFullSymbol(lines[i], index, symbol.name) && !isInCommentOrString(lines[i], index, symbol.name)) {
					foundTokens.push({start: index, len: symbol.name.length, tokenType: 1, tokenClass: 0});
				}
			}
		});
		movementSymbols.forEach(symbol => {
			if(symbol.position.line != i) {
				let index = lines[i].indexOf(symbol.name);
				if(index != -1 && isFullSymbol(lines[i], index, symbol.name) && !isInCommentOrString(lines[i], index, symbol.name)) {
					foundTokens.push({start: index, len: symbol.name.length, tokenType: 3, tokenClass: 0});
				}
			}
		});
		textSymbols.forEach(symbol => {
			if(symbol.position.line != i) {
				let index = lines[i].indexOf(symbol.name);
				if(index != -1 && isFullSymbol(lines[i], index, symbol.name) && !isInCommentOrString(lines[i], index, symbol.name)) {
					foundTokens.push({start: index, len: symbol.name.length, tokenType: 3, tokenClass: 0});
				}
			}
		});
		includedTokens.forEach(token => {
			let index = lines[i].indexOf(token.name);
			if(index != -1 && isFullSymbol(lines[i], index, token.name) && !isInCommentOrString(lines[i], index, token.name)) {
				let highlightType = 0;
				if(token.type === "special") {
					highlightType = 1;
				} else if(token.type === "define") {
					highlightType = 2;
				}
				foundTokens.push({start: index, len: token.name.length, tokenType: highlightType, tokenClass: 0});
			}
		});
		foundTokens.sort((token1, token2) => (token1.start < token2.start ? -1 : 1));
		for(let token of foundTokens)
		{
			builder.push(i, token.start, token.len, token.tokenType, token.tokenClass);
		}
	}
	return builder.build();
}

connection.onInitialized(async () => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			documentCommands.clear();
		});
	}
	let poryFiles : Array<string> = await connection.sendRequest("poryscript/getPoryscriptFiles");
	for(let file of poryFiles)
	{
		let uri : string = "file://" + file;
		globalSymbolMap.set(uri, parseDocumentSymbols(file));
	}
});

// The example settings
interface PoryScriptSettings {
	commandIncludes: Array<string>;
	symbolIncludes: Array<SettingsTokenInclude>;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: PoryScriptSettings = { 
	commandIncludes: ["asm/macros/event.inc", "asm/macros/movement.inc"],
	symbolIncludes: [
		{expression: "^\\s*def_special\\s+(\\w+)", type: "special", file: "data/specials.inc"}
	]
};
let globalSettings: PoryScriptSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<PoryScriptSettings>> = new Map();

let documentCommands: Map<string, Thenable<Map<string, Command>>> = new Map();
let documentConstants: Map<string, Thenable<Map<string, ConstantSymbol>>> = new Map();
let globalSymbolMap: Map<string, Thenable<PoryscriptSymbolCollection>> = new Map();
let globalIncludedTokenMap: Map<string, Thenable<Array<PoryscriptIncludedToken>>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
		documentCommands.clear();
	} else {
		globalSettings = <PoryScriptSettings>(
			(change.settings.languageServerPoryscript || defaultSettings)
		);
	}
	// Scan for commands in each document
	documents.all().forEach(updateCommandsForDocument);
	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function addPoryscriptSectionSymbol(re: RegExp, line: string, lineIndex: number, container: Array<SectionSymbol>) : void {
	let match = re.exec(line);
	if(match != null)
		container.push({position: Position.create(lineIndex, match.index), name: match[1]});
}

async function parseDocumentSymbols(file: string) : Promise<PoryscriptSymbolCollection> {
	//NOTE: this will not work with multi line declared sections
	let text = await connection.sendRequest("poryscript/readfs", file) as string;
	let lines = text.split(/\r?\n/);
	let scriptRegex = /script\s+(\w+)\s*\{/;
	let movementRegex = /movement\s+(\w+)\s*\{/;
	let mapscriptRegex = /mapscript\s+(\w+)\s*\{/;
	let textRegex = /text\s+(\w+)\s*\{/;
	let scriptSymbols = new Array<SectionSymbol>();
	let movementSymbols = new Array<SectionSymbol>();
	let mapscriptSymbols = new Array<SectionSymbol>();
	let textSymbols = new Array<SectionSymbol>();
	for(let i = 0; i < lines.length; ++i) {
		addPoryscriptSectionSymbol(scriptRegex, lines[i], i, scriptSymbols);
		addPoryscriptSectionSymbol(movementRegex, lines[i], i, movementSymbols);
		addPoryscriptSectionSymbol(mapscriptRegex, lines[i], i, mapscriptSymbols);
		addPoryscriptSectionSymbol(textRegex, lines[i], i, textSymbols);
	}
	return {scripts: scriptSymbols, mapScripts: mapscriptSymbols, movementScripts: movementSymbols, textSections: textSymbols};
}

function readBackToNewLine(file: string, position: number) : number {
	while(position != 0 && file[position] != '\n'){position--;}
	if(file[position] == '\n')
		position--;
	if(file[position] == '\r')
		position--;
	return position;
}

function skipWhitespace(file: string, position: number) : number {
	while(position < file.length) {
		if(file[position] == ' ' || file[position] == '\t' || file[position] == '\n' || file[position] == '\r')
			position++;
		else
			return position;
	}
	return position;
}

function readLine(file: string, position: number) : {line: string, position: number} {
	let startPos: number = position;
	while(file[position] != '\r' && file[position] != '\n' && position < file.length) {
		position++;
	}
	return {
		line: file.substr(startPos, position-startPos),
		position: position
	};
}

function readCommandDocumentation(file: string, position: number) : string {
	position = readBackToNewLine(file, position);
	position = readBackToNewLine(file, position);
	if(position != 0)
		position++;
	position = skipWhitespace(file, position);
	let doc : Stack<string> = new Stack<string>();
	let lastPosition: number = -1;
	let x = file[position];
	while(file[position] == '@') {
		if(position == lastPosition)
			break;
		lastPosition = position;
		position = skipWhitespace(file,position+1);
		doc.push(readLine(file, position).line);
		position = readBackToNewLine(file,position);
		position = readBackToNewLine(file,position);
		if(position == 0)
			break;
		position++;
		position = skipWhitespace(file,position);
	}
	let out: string = "";
	while(!doc.isEmpty()) {
		if(out != "")
			out += ' ';
		out += doc.pop();
	}
	return out;
}

function skipWhitespaceAndComma(s: string, position: number) : number {
	while(position < s.length) {
		if(s[position] == ' ' || s[position] == '\t' || s[position] == ',')
			position++;
		else
			return position;
	}
	return position;
}

function parseParameters(parameterString: string) : CommandParameter[] {
	let parameters : CommandParameter[] = [];
	let position : number = 0;
	let currentBegin : number = 0;
	while(position < parameterString.length) {
		if(parameterString[position] == ':') {
			let currentParam = parameterString.substring(currentBegin, position);
			position+=4;
			position = skipWhitespaceAndComma(parameterString, position);
			currentBegin = position;
			parameters.push({
				name: currentParam,
				kind: CommandParameterKind.Required,
				default: ""
			});
		} else if(parameterString[position] == '=') {
			let currentParam = parameterString.substring(currentBegin, position);
			position++;
			let defaultBegin = position;
			while(position < parameterString.length && parameterString[position] != ' ' && parameterString[position] != '\t') {
				position++;
			}
			let currentDefault;
			if(position == parameterString.length) {
				currentDefault = parameterString.substring(defaultBegin, position);
			} else {
				currentDefault = parameterString.substring(defaultBegin, position-1);
			}
			position = skipWhitespaceAndComma(parameterString, position);
			currentBegin = position;
			parameters.push({
				name: currentParam,
				kind: CommandParameterKind.Default,
				default: currentDefault
			});
		} else if(parameterString[position] == ' ' || parameterString[position] == '\t' || parameterString[position] == ','){
			let currentParam = parameterString.substring(currentBegin, position);
			position = skipWhitespaceAndComma(parameterString, position);
			currentBegin = position;
			parameters.push({
				name: currentParam,
				kind: CommandParameterKind.Optional,
				default: ""
			});
		}
		position++;
	}
	return parameters;
}

function parseScriptCommands(file: string) : Map<string, Command> {
	let commands : Map<string,Command> = new Map();
	let re = /\.macro (\w+)(?:[ \t])*((?:[ \t,\w:=])*)/g;
	let match = re.exec(file);
	while(match != null) {
		let commandParameters = undefined;
		if(match[2] != "") {
			commandParameters = parseParameters(match[2]);
		}
		commands.set(match[1], {
			kind: CompletionItemKind.Function,
			documentation: readCommandDocumentation(file, match.index),
			parameters: commandParameters
		});
		match = re.exec(file);
	}
	return commands;
}

function parseAssemblyConstants(file: string) : Map<string, Command> {
	let commands : Map<string, Command> = new Map();
	let re = /^[\t ]*(\w+)[\t ]*=[\t ]*([\w\d]+)[\w\t]*$/gm;
	let match = re.exec(file);
	while(match != null) {
		let key = match[1];
		let value = match[2];
		commands.set(key, {
			kind: CompletionItemKind.Constant,
			detail: value
		});
		match = re.exec(file);
	}
	return commands;
}

function parseMovementConstants(file: string) : Map<string, Command> {
	let commands : Map<string, Command> = new Map();
	let re = /^[\t ]*(?:create_movement_action)[\t ]* ([\w\d]+)[\t ]*$/gm;
	let match = re.exec(file);
	while(match != null) {
		let key = match[1];
		commands.set(key, {
			kind: CompletionItemKind.Constant,
			detail: "movement"
		});
		match = re.exec(file);
	}
	return commands;
}

function mergeCommands(to: Map<string,Command>, from: Map<string,Command>) {
	for(let key of from.keys()){
		let val = from.get(key);
		if(val)
			to.set(key, val);
	}
}

async function parseDocumentConstants(resource : string) : Promise<Map<string, ConstantSymbol>> {
	let document = documents.get(resource);
	let constants = new Map<string, ConstantSymbol>();
	if(!document)
		return constants;
	let text = document.getText();
	let lines = text.split(/\r?\n/);
	let re = /const\s+(\w+)\s*=\s*(\w+)/
	for(let i = 0; i < lines.length; ++i) {
		let match = re.exec(lines[i]);
		if(match != null) {
			constants.set(match[1], {
				name: match[1],
				position: Position.create(i, match.index),
				resolution: match[2]
			});
		}
	}
	return constants;
}

async function scanForCommands(resource: string) : Promise<Map<string, Command>>
{
	let commands = new Map<string, Command>();
	let settings = await getDocumentSettings(resource);
	if(hasWorkspaceFolderCapability) {
		for(let include of settings.commandIncludes) {
			connection.sendRequest("poryscript/readfile", include).then((values) => {
				let file = <string>(values);
				let scriptCommands : Map<string,Command> = parseScriptCommands(file);
				let constantCommands : Map<string, Command> = parseAssemblyConstants(file);
				let movementCommands : Map<string, Command> = parseMovementConstants(file);
				mergeCommands(commands, scriptCommands);
				mergeCommands(commands, constantCommands);
				mergeCommands(commands, movementCommands);
			});
		}
	}
	commands.set('script', {
		detail: "Script (Poryscript)",
		kind: CompletionItemKind.Class,
		insertText: "script ${0:MyScript} {\n    \n}"
	});
	commands.set('movement', {
		detail: "Movement (Poryscript)",
		kind: CompletionItemKind.Class,
		insertText: "movement ${0:MyMovement} {\n    \n}"
	});
	commands.set('mapscripts', {
		detail: "Mapscript Section (Poryscript)",
		kind: CompletionItemKind.Class,
		insertText: "mapscripts ${0:MyMapscripts} {\n    \n}"
	});
	commands.set('text', {
		detail: "Text (Poryscript)",
		kind: CompletionItemKind.Class,
		insertText: "text ${0:MyString} {\n    \n}"
	});
	commands.set('raw', {
		detail: "Raw Section (Poryscript)",
		kind: CompletionItemKind.Class,
		insertText: "raw `\n$0\n`"
	});
	commands.set('local', {
		detail: "Local Section (Poryscript)",
		kind: CompletionItemKind.Keyword
	});
	commands.set('global', {
		detail: "Global Section (Poryscript)",
		kind: CompletionItemKind.Keyword
	});
	commands.set('format', {
		detail: "Format String",
		kind: CompletionItemKind.Text,
		insertText: "format(\"$0\")"
	});
	commands.set('var', {
		detail: "Get the value of a variable",
		kind: CompletionItemKind.Reference,
		insertText: "var(${0:VAR_ID})"
	});
	commands.set('flag', {
		detail: "Get the value of a flag",
		kind: CompletionItemKind.Reference,
		insertText: "flag(${0:FLAG_ID})"
	});
	commands.set('defeated', {
		detail: "Get the status of a trainer",
		kind: CompletionItemKind.Reference,
		insertText: "defeated(${0:TRAINER_ID})"
	});
	commands.set('poryswitch', {
		detail: "Compile time switch",
		insertText: "poryswitch(${0:SWITCH_CONDITION}) {\n    _:\n}",
		parameters: [
			{
				name: "SWITCH_CONDITION",
				kind: CommandParameterKind.Required,
				default: ""
			}
		]
	})
	commands.set('if', {});
	commands.set('elif', {});
	commands.set('else', {});
	commands.set('while', {});
	commands.set('switch', {});
	commands.set('case', {});
	commands.set('break', {});
	commands.set('continue', {});
	return commands;
}

function getOrScanDocumentCommands(resource: string): Thenable<Map<string, Command>> {
	let result = documentCommands.get(resource);
	if(!result) {
		result = scanForCommands(resource);
		documentCommands.set(resource, result);
	}
	return result;
}

async function updateCommandsForDocument(textDocument: TextDocument) : Promise<void> {
	await getOrScanDocumentCommands(textDocument.uri);
}

async function parseIncludedTokens(settings: SettingsTokenInclude) : Promise<Array<PoryscriptIncludedToken>> {
	let text: string = await connection.sendRequest("poryscript/readfile", settings.file);
	let out = new Array<PoryscriptIncludedToken>();
	let lines = text.split(/\r?\n/);
	let regex = new RegExp(settings.expression);
	for(let i = 0; i < lines.length; ++i) {
		let match = regex.exec(lines[i]);
		if(match != null) {
			let currentValue = undefined;
			if(settings.type === "define")
				currentValue = match[2];
			
			out.push({name: match[1], position: Position.create(i, match.index), type: settings.type, value: currentValue});
		}
	}
	return out;
}

function getDocumentSettings(resource: string): Thenable<PoryScriptSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerPoryscript'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentCommands.delete(e.document.uri);
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async (change) => {
	if(change.document.uri.startsWith("file://"))
	{
		globalSymbolMap.set(change.document.uri, parseDocumentSymbols(change.document.uri.substring(7)));
	}
	documentConstants.set(change.document.uri, parseDocumentConstants(change.document.uri));
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	//TODO: Write our own validation handler

	// // In this simple example we get the settings for every validate run.
	// let settings = await getDocumentSettings(textDocument.uri);
	// // The validator creates diagnostics for all uppercase words length 2 and more
	// let text = textDocument.getText();
	// let pattern = /\b[A-Z]{2,}\b/g;
	// let m: RegExpExecArray | null;

	// let problems = 0;
	// let diagnostics: Diagnostic[] = [];
	// while ((m = pattern.exec(text))) {
	// 	problems++;
	// 	let diagnostic: Diagnostic = {
	// 		severity: DiagnosticSeverity.Warning,
	// 		range: {
	// 			start: textDocument.positionAt(m.index),
	// 			end: textDocument.positionAt(m.index + m[0].length)
	// 		},
	// 		message: `${m[0]} is all uppercase.`,
	// 		source: 'ex'
	// 	};
	// 	if (hasDiagnosticRelatedInformationCapability) {
	// 		diagnostic.relatedInformation = [
	// 			{
	// 				location: {
	// 					uri: textDocument.uri,
	// 					range: Object.assign({}, diagnostic.range)
	// 				},
	// 				message: 'Spelling matters'
	// 			},
	// 			{
	// 				location: {
	// 					uri: textDocument.uri,
	// 					range: Object.assign({}, diagnostic.range)
	// 				},
	// 				message: 'Particularly for names'
	// 			}
	// 		];
	// 	}
	// 	diagnostics.push(diagnostic);
	// }

	// // Send the computed diagnostics to VSCode.
	// connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	// If one of the include files changed, we need to reset our current command cache
	_change.changes.forEach(change => {
		getDocumentSettings(change.uri).then(settings => {
			let dirty : boolean = false;
			for(let include of settings.commandIncludes){
				if(change.uri.endsWith(include)) {
					documentCommands.clear();
					dirty = true;
				}
			}
			if(dirty) {
				documents.all().forEach(updateCommandsForDocument);
			}
			if(change.uri.endsWith(".pory") && change.uri.startsWith("file://"))
			{
				globalSymbolMap.set(change.uri, parseDocumentSymbols(change.uri.substring(7)));
			}
			for(let setting of settings.symbolIncludes) {
				if(change.uri.endsWith(setting.file)) {
					globalIncludedTokenMap.set(setting.file+":"+setting.expression, parseIncludedTokens(setting));
				}
			}
		});
	});
});

function constantToCompletionItem(name: string, constant: ConstantSymbol) : CompletionItem {
	let item : CompletionItem = {
		label: name,
		kind: CompletionItemKind.Constant,
		documentation: "",
		detail: ""
	}
	return item;
}

function includedTokenToCompletionItem(token: PoryscriptIncludedToken) : CompletionItem {
	let completionKind: CompletionItemKind = CompletionItemKind.Value;
	let detail: string = "";
	if(token.type === "special") {
		completionKind = CompletionItemKind.Function;
		detail = "Special Function";
	} else if(token.type === "define") {
		completionKind = CompletionItemKind.Constant;
		if(token.value)
			detail = token.value;
	}
	let item: CompletionItem = {
		label: token.name,
		kind: completionKind,
		documentation: "",
		detail: detail,
	}
	return item;
}

function symbolToCompletionItem(symbol: SectionSymbol, kind: CompletionItemKind, detail?:string) : CompletionItem {
	let item : CompletionItem = {
		label: symbol.name,
		kind: kind,
		documentation: "",
		detail: detail,
	}
	return item;
}

function commandToCompletionItem(id: string, command: Command) : CompletionItem {
	let item : CompletionItem = {
		label: id,
		kind: command.kind || CompletionItemKind.Keyword,
		documentation: command.documentation || "",
		detail: command.detail || ""
	};
	if(command.insertText) {
		item.insertText = command.insertText;
		item.insertTextFormat = InsertTextFormat.Snippet;
	}
	
	return item;
}

async function generateGlobalIncludedTokensTable() : Promise<Array<PoryscriptIncludedToken>>
{
	let out = new Array<PoryscriptIncludedToken>();
	for(let promise of globalIncludedTokenMap.values())
	{
		out = out.concat(await promise);
	}
	return out;
}

async function generateGlobalSymbolTable() : Promise<Array<PoryscriptSymbolCollection>>{
	let out = new Array<PoryscriptSymbolCollection>();
	for(let promise of globalSymbolMap.values())
	{
		out.push(await promise);
	}
	return out;
}

connection.onCompletion(
	(async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		let commands = await getOrScanDocumentCommands(_textDocumentPosition.textDocument.uri);
		let constants = await documentConstants.get(_textDocumentPosition.textDocument.uri);
		let commandsArray = Array.from(commands).map(([key,value]) => commandToCompletionItem(key,value));
		let constantsArray = new Array();
		if(constants)
			constantsArray = Array.from(constants).map(([key, value]) => constantToCompletionItem(key, value));
		let symbols = await generateGlobalSymbolTable();
		let scriptCompletions = symbols.flatMap(sym => sym.scripts).map(sym => symbolToCompletionItem(sym, CompletionItemKind.Function, "Script"));
		let mapscriptCompletions = symbols.flatMap(sym => sym.mapScripts).map(sym => symbolToCompletionItem(sym, CompletionItemKind.Function, "Mapscript"));
		let movementCompletions = symbols.flatMap(sym => sym.movementScripts).map(sym => symbolToCompletionItem(sym, CompletionItemKind.Field, "Movement Script"));
		let textCompletions = symbols.flatMap(sym => sym.textSections).map(sym => symbolToCompletionItem(sym, CompletionItemKind.Field, "Text"));
		let includedTokens = await generateGlobalIncludedTokensTable();
		let includedTokensCompletions = includedTokens.map(token => includedTokenToCompletionItem(token));

		return commandsArray.concat(constantsArray).concat(scriptCompletions).concat(mapscriptCompletions).concat(movementCompletions).concat(textCompletions).concat(includedTokensCompletions);
	}
));

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		item.preselect
		return item;
	}
);

function gatherCallInformation(document: TextDocument, position: Position) : {command: string, openParen: Position, closingParen: Position, commas: Position[]} | undefined {
	let char = document.offsetAt(position);
	let text = document.getText();
	let openParen: Position | undefined;
	let closingParen: Position | undefined;
	let commas : Position[] = [];
	while(char > 0 && text[char] != '\n' && text[char] != '\r') {
		if(text[char] == '(') {
			openParen = document.positionAt(char);
		}
		char--;
	}
	if(!openParen)
		return undefined;
	let openPos = document.offsetAt(openParen);
	char = openPos;
	while(text[char] != ' ' && text[char] != '\t' && text[char] != '\r' && text[char] != '\n' && char > 0) {
		char--;
	}
	char++;
	let command = text.substring(char, openPos);
	while(char < text.length && text[char] != '\n' && text[char] != '\r') {
		if(document.offsetAt(openParen) < char) {
			if(text[char] == ')')
				closingParen = document.positionAt(char);
			if(text[char] == ',')
				commas.push(document.positionAt(char));
		}
		char++;
	}
	if(!closingParen)
		return undefined;
	return {
		command: command,
		openParen: openParen,
		closingParen: closingParen,
		commas: commas
	};
}

function buildParameterKindString(parameter: CommandParameter) : MarkupContent {
	if(parameter.kind == CommandParameterKind.Default) {
		return {
			value: parameter.name + "=" + parameter.default,
			kind: "markdown"
		};
	}
	if(parameter.kind == CommandParameterKind.Optional) {
		return {
			value: parameter.name + " *Optional*",
			kind: "markdown"
		};
	}
	if(parameter.kind == CommandParameterKind.Required) {
		return {
			value: parameter.name + " *Required*",
			kind: "markdown"
		};
	}
	return {
		value: "",
		kind: "plaintext"
	};
}

function buildParameterInformation(parameters: CommandParameter[]) : ParameterInformation[] {
	let out : ParameterInformation[] = [];
	for(let parameter of parameters) {
		out.push({
			label: parameter.name,
			documentation: buildParameterKindString(parameter)
		})
	}
	return out;
}

function buildParameterLabelName(parameter: CommandParameter) : string {
	if(parameter.kind == CommandParameterKind.Default)
		return '[' + parameter.name + "=" + parameter.default + ']';
	if(parameter.kind == CommandParameterKind.Optional)
		return '[' + parameter.name + ']';
	if(parameter.kind == CommandParameterKind.Required)
		return parameter.name;
	return "";
}

function buildParameterLabel(name: string, parameters: CommandParameter[]) : string {
	let out: string = name + "(";
	let names: string[] = [];
	parameters.forEach(p => names.push(buildParameterLabelName(p)));
	out += names.join(', ');
	out += ')';
	return out;
}
connection.onSignatureHelp(async (params: TextDocumentPositionParams) : Promise<SignatureHelp | undefined> => {
	let document = documents.get(params.textDocument.uri);
	let commands = await getOrScanDocumentCommands(params.textDocument.uri);

	if(!document)
		return undefined;
	let info = gatherCallInformation(document, params.position);
	if(!info)
		return undefined;
	
	let command = commands.get(info.command);
	if(!command)
		return undefined;

	if(!command.parameters)
		return undefined;

	if(command.parameters.length == 0)
		return undefined;

	if(params.position.character < info.openParen.character+1 || params.position > info.closingParen)
		return undefined;
	
	let parameterId = 0;
	while(info.commas.length > parameterId && params.position.character > info.commas[parameterId].character) {
		parameterId++
	}
	return {
		activeParameter: parameterId,
		activeSignature: 0,
		signatures: [
			{
				label: buildParameterLabel(info.command, command.parameters),
				documentation: command.documentation,
				parameters: buildParameterInformation(command.parameters)
			}
		]
	};
});

documents.onDidOpen(async (e : TextDocumentChangeEvent<TextDocument>) => {
	updateCommandsForDocument(e.document);
	let settings = await getDocumentSettings(e.document.uri);
	for(let setting of settings.symbolIncludes) {
		globalIncludedTokenMap.set(setting.file+":"+setting.expression, parseIncludedTokens(setting));
	}
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
