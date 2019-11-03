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
} from 'vscode-languageserver';
import { stringify } from 'querystring';

let sp = require('synchronized-promise');

// TypeScript type for caching the script command intelliSense
type Command = { documentation?: string, detail?: string, kind?: CompletionItemKind, insertText?: string};

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

async function scanForCommands(resource: string) : Promise<Map<string, Command>>
{
	let commands = new Map<string, Command>();
	let settings = await getDocumentSettings(resource);
	if(hasWorkspaceFolderCapability) {
		for(let include of settings.commandIncludes) {
			connection.sendRequest("poryscript/readfile", include).then((values) => {
				let file = <string>(values);
				let re = /\.macro (\w+)(?:[ \t])*((?:[ \t,\w:])*)/g;
				let match = re.exec(file);
				while(match != null) {
					let insertText = undefined;
					if(match[2] != "") {
						insertText = match[1] + '($0)';
					}
					commands.set(match[1], {
						kind: CompletionItemKind.Function,
						insertText: insertText
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
		kind: CompletionItemKind.Function,
		insertText: "format(\"$0\")"
	});
	commands.set('var', {
		detail: "Get the value of a variable",
		kind: CompletionItemKind.Function,
		insertText: "var(${0:VAR_ID})"
	});
	commands.set('flag', {
		detail: "Get the value of a flag",
		kind: CompletionItemKind.Function,
		insertText: "flag(${0:FLAG_ID})"
	});
	commands.set('defeated', {
		detail: "Get the status of a trainer", kind: CompletionItemKind.Function,
		insertText: "defeated(${0:TRAINER_ID})"
	});
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
	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);
	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();
	let pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	let diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text))) {
		problems++;
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
	_change.changes.forEach(change => {
		getDocumentSettings(change.uri).then(settings => {
			for(let include of settings.commandIncludes){
				if(change.uri.endsWith(include)) {
					getOrScanDocumentCommands(change.uri);
				}
			}
		});
	});
});

//doc?
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


connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.textDocument.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.textDocument.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.textDocument.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.textDocument.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
