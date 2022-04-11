import { pathToFileURL } from "url";
import * as path from 'path';
import * as vs from 'vscode';
import { promisify } from "util";
import * as fs from 'fs';
import { download, fetchRelease } from "./net";

const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);

export function GetPlsBinaryName() : string | undefined {
    if (process.arch === 'x64' || process.arch === 'ia32') {
        if (process.platform == 'linux') {
            return 'poryscript-pls-linux';
        }
        if (process.platform === 'darwin') {
            return 'poryscript-pls-mac';
        }
        if (process.platform === 'win32') {
            return 'poryscript-pls-windows.exe'
        }
    }
    return undefined
}

export function GetPlsDebugBinaryName() : string {
    if (process.arch === 'x64' || process.arch === 'ia32') {
        if (process.platform == 'linux' || process.platform === 'darwin') {
            return 'poryscript-pls';
        }
        if (process.platform === 'win32') {
            return 'poryscript-pls.exe'
        }
    }
    return undefined
}

export function GetInstallDir() : string | undefined {
    if (process.platform === 'linux' || process.platform === 'darwin') {
        const { HOME, XDG_DATA_HOME, XDG_BIN_HOME } = process.env;
        if (XDG_BIN_HOME) {
            return path.resolve(XDG_BIN_HOME)
        }
        const baseDir = XDG_DATA_HOME ? path.join(XDG_DATA_HOME, '..') : HOME && path.join(HOME, '.local');
        return baseDir && path.resolve(path.join(baseDir, 'bin'));
    } else if (process.platform === 'win32') {
        const { LocalAppData } = process.env;
        return ( LocalAppData && path.resolve(path.join(LocalAppData, 'poryscript-pls')) );
    }
    return undefined;
}

export function GetMetadataDir() : string | undefined {
    if (process.platform === 'linux' || process.platform === 'darwin') {
        const { HOME, XDG_CONFIG_HOME } = process.env;
        const baseDir = XDG_CONFIG_HOME || (HOME && path.join(HOME, '.config'));
        return baseDir && path.resolve(path.join(baseDir, 'poryscript-pls'));
    } else if (process.platform == 'win32') {
        const { LocalAppData } = process.env;
        return ( LocalAppData && path.resolve(path.join(LocalAppData, 'poryscript-pls')) );
    }
}

interface PoryscriptPlsConfig {
    askBeforeDownload?: boolean;
    package: {
        releaseTag: string;
    };
}

/**
 * TODO:
 * Fetch and handle metadata
 */
export async function getServer({askBeforeDownload, package: pkg} : PoryscriptPlsConfig) : Promise<string | undefined> {
    let binaryName = GetPlsBinaryName();
    if (binaryName === undefined) {
        vs.window.showErrorMessage(
            "We don't ship binaries for your platform yet. " +
            "You can manually clone the poryscript-pls repository and " +
            "run `go build` to build the language server from sources. " + 
            "If you feel that your platform should be supported, please create an issue " +
            "[here](https://github.com/huderlem/poryscript-pls/issues) and we will consider it."
        );
        return undefined;
    }
    const dir = GetInstallDir();
    if (!dir) {
        return;
    }
    await ensureDir(dir);
    const dest = path.join(dir, binaryName);
    const exists = await stat(dest).catch(() => false);
    if (exists) {
        return dest;
    }

    if (askBeforeDownload) {
        const userResponse = await vs.window.showInformationMessage(`\`poryscript-pls\` ${pkg.releaseTag} is not installed.\nInstall to ${dir}?`, 'Download');
        if (userResponse !== 'Download') {
            return dest;
        }
    }
    const release = await fetchRelease('huderlem', 'poryscript-pls', pkg.releaseTag);
    const artifact = release.assets.find(asset => asset.name === binaryName);
    if (!artifact) {
        throw new Error(`Bad release: ${JSON.stringify(release)}`);
    }

    await download(artifact.browser_download_url, dest, 'Downloading poryscript-pls', {mode: 0o755});
    return dest;
}

function ensureDir(path: string) {
    return !!path && stat(path).catch(() => mkdir(path, { recursive: true }));
}