import { GithubRelease } from "../net";

export function getNewestRelease(majorVersion: string, releases: Array<GithubRelease>) : GithubRelease | undefined {
    let found : GithubRelease = undefined;
    let bestMinor : Number = 0;
    let bestFixed : Number = 0;
    for (const release of releases) {
        // Check if the release name follow semantic versioning

        const semantic = release.name.split('.');
        if (semantic.length !== 3)
            continue;
        if (isNaN(+semantic[0]))
            continue;
        if (isNaN(+semantic[1]))
            continue;
        if (isNaN(+semantic[2]))
            continue;
        
        // Check if the major version matches
        if (semantic[0] !== majorVersion)
            continue;

        const currentMinor = parseInt(semantic[1]);
        const currentFixed = parseInt(semantic[2]);
        if (currentMinor > bestMinor) {
            bestMinor = currentMinor;
            found = release;
        } else if (currentMinor === bestMinor && currentFixed > bestFixed) {
            bestFixed = currentFixed;
            found = release;
        }
    }
    return found;
}