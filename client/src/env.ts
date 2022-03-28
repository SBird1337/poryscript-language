export function GetPlsBinaryName() : string {
    switch(process.platform) {
        case "win32" :
            return "poryscript-pls.exe";
        default:
            return "poryscript-pls";
    }
}
