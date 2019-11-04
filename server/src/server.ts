/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection,
	TextDocuments,
	TextDocument,
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
} from 'vscode-languageserver';
import { Stack } from './datastructs';

let sp = require('synchronized-promise');

enum CommandParameterKind {
	Required, Default, Optional
}

type CommandParameter = { name: string, kind: CommandParameterKind, default: string};
// TypeScript type for caching the script command intelliSense
type Command = { documentation?: string, detail?: string, kind?: CompletionItemKind, insertText?: string, parameters?: CommandParameter[]};

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

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
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			},
			signatureHelpProvider: {
				triggerCharacters: ['(', ',']
			}
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface PoryScriptSettings {
	commandIncludes: Array<string>;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: PoryScriptSettings = { commandIncludes: ["asm/macros/event.inc"] };
let globalSettings: PoryScriptSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<PoryScriptSettings>> = new Map();
let documentCommands: Map<string, Thenable<Map<string, Command>>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
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

async function scanForCommands(resource: string) : Promise<Map<string, Command>>
{
	let commands = new Map<string, Command>();
	let settings = await getDocumentSettings(resource);
	if(hasWorkspaceFolderCapability) {
		for(let include of settings.commandIncludes) {
			connection.sendRequest("poryscript/readfile", include).then((values) => {
				let file = <string>(values);
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
			});
		}
	}
	connection.console.log("hello world");
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

function getOrScanDocumentCommandsSync(resource: string): Map<string, Command> {
	let syncFunc = sp(getOrScanDocumentCommands);
	return syncFunc(resource);
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
documents.onDidChangeContent(change => {
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
			for(let include of settings.commandIncludes){
				if(change.uri.endsWith(include)) {
					documentCommands.clear();
				}
			}
		});
	});
});

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

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		let commands = getOrScanDocumentCommandsSync(_textDocumentPosition.textDocument.uri);
		return Array.from(commands).map(([key,value]) => commandToCompletionItem(key,value));
	}
);

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

connection.onSignatureHelp((params: TextDocumentPositionParams) : SignatureHelp | undefined => {
	let document = documents.get(params.textDocument.uri);
	let commands = getOrScanDocumentCommandsSync(params.textDocument.uri);

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

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
