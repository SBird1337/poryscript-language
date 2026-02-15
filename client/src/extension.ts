import * as path from 'path';
import * as fs from 'fs';
import * as url from "url";

import { workspace, ExtensionContext, Uri, window, TextEditorDecorationType, DecorationRangeBehavior, Diagnostic, DecorationOptions, MarkdownString } from 'vscode';
import {
    Executable,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient/node';

import { getServer } from './env';
import { getPlsDebugBinaryName } from './env';

let client: LanguageClient;
let lineTooLongDecoration: TextEditorDecorationType;

function applyLineTooLongDecorations(uri: Uri, diagnostics: Diagnostic[]) {
    const editor = window.visibleTextEditors.find(
        e => e.document.uri.toString() === uri.toString()
    );
    if (!editor) {
        return;
    }
    const decorations: DecorationOptions[] = diagnostics.map(d => ({
        range: d.range,
        hoverMessage: new MarkdownString(d.message),
    }));
    editor.setDecorations(lineTooLongDecoration, decorations);
}

export async function activate(context: ExtensionContext) {
    lineTooLongDecoration = window.createTextEditorDecorationType({
        backgroundColor: '#E69F0030',
        border: '1px solid #E69F00'
    });

    context.subscriptions.push(lineTooLongDecoration);

    const configuration = workspace.getConfiguration();
    const customBinPath = configuration.get<string>("languageServerPoryscript.poryscript-pls.path");
    const debugPlsPath = context.asAbsolutePath(path.join('poryscript-pls', getPlsDebugBinaryName()))
    const releasePlsPath = customBinPath || await getServer(true);

    if (!releasePlsPath) {
        throw new Error("Couldn't fetch poryscript-pls binary");
    }

    const debugServerExecutable: Executable = {
        command: debugPlsPath
    };

    const releaseServerExecutable: Executable = {
        command: releasePlsPath
    };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        debug: debugServerExecutable,
        run: releaseServerExecutable
    };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for poryscript documents
        documentSelector: [{ scheme: 'file', language: 'poryscript' }, { scheme: 'file', language: 'poryscript-asm' }],
        synchronize: {
            // Notify the server about file changes to *.inc, *.pory, *.h files contained in the workspace
            fileEvents: [workspace.createFileSystemWatcher('**/*.inc'), workspace.createFileSystemWatcher('**/*.pory'), workspace.createFileSystemWatcher('**/*.h')]
        },
        middleware: {
            handleDiagnostics(uri, diagnostics, next) {
                const lineTooLongDiags: typeof diagnostics = [];
                const otherDiags: typeof diagnostics = [];
                for (const diag of diagnostics) {
                    if (diag.code === 'warning-lineTooLong') {
                        lineTooLongDiags.push(diag);
                    } else {
                        otherDiags.push(diag);
                    }
                }
                applyLineTooLongDecorations(uri, lineTooLongDiags);
                next(uri, otherDiags);
            }
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
            if (fs.existsSync(openPath)) {
                let uri = Uri.file(openPath);
                return workspace.openTextDocument(uri).then(doc => doc.getText());
            }
            return "";
        });
        client.onRequest("poryscript/readfs", file => {
            let openPath = Uri.parse(file).fsPath;
            if (fs.existsSync(openPath)) {
                let uri = Uri.file(openPath);
                return workspace.openTextDocument(uri).then(doc => doc.getText());
            }
        });
        client.onRequest("poryscript/getPoryscriptFiles", async () => {
            let folder = workspace.workspaceFolders[0];
            return await (await workspace.findFiles("**/*.{pory}", null, 1024)).map(uri => uri.path);
        });
        client.onRequest("poryscript/getfileuri", file => {
            return url.pathToFileURL(path.join(workspace.workspaceFolders[0].uri.fsPath, file)).toString();
        });
    });
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

