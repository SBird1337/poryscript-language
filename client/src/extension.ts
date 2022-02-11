/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import * as fs from 'fs';
import { workspace, ExtensionContext, Uri } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for poryscript documents
		documentSelector: [{ scheme: 'file', language: 'poryscript' }, {scheme: 'file', language: 'poryscript-asm'}],
		synchronize: {
			// Notify the server about file changes to *.inc, *.pory, *.h files contained in the workspace
			fileEvents: [workspace.createFileSystemWatcher('**/*.inc'), workspace.createFileSystemWatcher('**/*.pory'), workspace.createFileSystemWatcher('**/*.h')]
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerPoryscript',
		'Language Server Poryscript',
		serverOptions,
		clientOptions
	);
	client.onReady().then(() => {
		client.onRequest("poryscript/readfile", file => {
			let openPath = path.join(workspace.workspaceFolders[0].uri.fsPath, file);
			if(fs.existsSync(openPath)) {
				let uri = Uri.file(openPath);
				return workspace.openTextDocument(uri).then(doc => doc.getText());
			}
			return "";
		});
		client.onRequest("poryscript/readfs", file => {
			let openPath = Uri.parse(file).fsPath;
			if(fs.existsSync(openPath))
			{
				let uri = Uri.file(openPath);
				return workspace.openTextDocument(uri).then(doc => doc.getText());
			}
		});
		client.onRequest("poryscript/getPoryscriptFiles", async () => {
			let folder = workspace.workspaceFolders[0];
			return await (await workspace.findFiles("**/*.{pory}", null, 1024)).map(uri => uri.path);
		});
		client.onRequest("poryscript/getfileuri", file => {
			return "file://" + path.join(workspace.workspaceFolders[0].uri.fsPath, file);
		});
	});
	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
