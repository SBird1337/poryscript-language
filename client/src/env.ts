import { pathToFileURL } from "url";
import * as path from 'path';
import * as vs from 'vscode';
import { promisify } from "util";
import * as fs from 'fs';
import { download, fetchAvailableReleases } from "./net";
import { getNewestRelease } from "./util/version";
import * as cp from 'child_process';

const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const exec = promisify(cp.exec);

const REQUESTED_MAJOR_VERSION = '0';

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

export async function getServer(askBeforeDownload : boolean) : Promise<string | undefined> {
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
        return undefined;
    }
    await ensureDir(dir);
    const dest = path.join(dir, binaryName);
    const exists = await stat(dest).catch(() => false);
    const releases = await fetchAvailableReleases('huderlem', 'poryscript-pls');
    const bestFittingRelease = getNewestRelease(REQUESTED_MAJOR_VERSION, releases);
    if (!bestFittingRelease) {
        vs.window.showErrorMessage(
            "Could not find poryscript-pls release with requested " + 
            "major version " + REQUESTED_MAJOR_VERSION + "."
        )
    }
    if (exists) {
        const currentVersion = await (await exec(dest + ' -v')).stdout.trim();
        if (bestFittingRelease.name === currentVersion)
            return dest;
        if (askBeforeDownload) {
            const userResponse = await vs.window.showInformationMessage(`A new version of poryscript-pls was found.\nDownload version ${bestFittingRelease.name} to ${dir}?`, 'Download', 'Skip');
            if (userResponse !== 'Download')
                return dest;
        }
        const artifact = bestFittingRelease.assets.find(asset => asset.name === binaryName);
        if (!artifact) {
            throw new Error(`Bad release: ${JSON.stringify(bestFittingRelease)}`);
        }
    
        await download(artifact.browser_download_url, dest, 'Downloading poryscript-pls', {mode: 0o755});
        return dest;
    }

    if (askBeforeDownload) {
        const userResponse = await vs.window.showInformationMessage(`poryscript-pls is not installed.\nDownload version ${bestFittingRelease.name} to ${dir}?`, 'Download');
        if (userResponse !== 'Download') {
            return dest;
        }
    }
    const artifact = bestFittingRelease.assets.find(asset => asset.name === binaryName);
    if (!artifact) {
        throw new Error(`Bad release: ${JSON.stringify(bestFittingRelease)}`);
    }

    await download(artifact.browser_download_url, dest, 'Downloading poryscript-pls', {mode: 0o755});
    return dest;
}

function ensureDir(path: string) {
    return !!path && stat(path).catch(() => mkdir(path, { recursive: true }));
}