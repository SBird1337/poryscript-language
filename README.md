# Poryscript Language Extension

Language client for `poryscript`. (https://github.com/huderlem/poryscript)

Uses the language server `poryscript-pls` (https://github.com/huderlem/poryscript-pls)

## Configuration

### Custom poryscript-pls

Normally the binaries of `poryscript-pls` for your platform will automatically be installed. If we do not ship binaries for your platform or you want to use a custom version you can supply a custom binary path in `languageServerPoryscript.poryscript-pls.path`.

### Custom Poryscript Command Configuration Filepath

Poryscript ships with a default `command_config.json` file, which is what defines the available autovar commands. This filepath defaults to `tools/poryscript/command_config.json`, but this can be overriden.

### Event/Movement macros

The extension parses files like `event.inc` and `movement.inc` to provide completion hints on your LSP client. (Visual Studio Code)
It needs to know where those files are with respect to your root workspace. To do so, it reads the property `languageServerPoryscript.commandIncludes` of your `settings.json`.
If the field is not set it defaults to the following setting:

```json
{
    "languageServerPoryscript.commandIncludes": [
        "asm/macros/event.inc",
        "asm/macros/movement.inc"
    ]
}
```

### Auxillary Semantic Highlighting

The extension also parses customizable files to read values usually present when working with `poryscript`. A few are included in the default settings, but new ones can be configured or changed at will. Each entry contains a regular `expression`, a type which can be `special` or `define` and a `file` path. The first match group of the regular expression will be treated as the name of the defined token. The second group will be treated as a detail in the completion hint window. The default settings are:

```json
    "languageServerPoryscript.symbolIncludes": [
    
        {
            "expression": "^\\s*def_special\\s+(\\w+)",
            "type": "special",
            "file": "data/specials.inc"
        },
        {
            "expression": "^\\s*#define\\s+(FLAG_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/flags.h"
        },
        {
            "expression": "^\\s*#define\\s+(VAR_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/vars.h"
        },
        {
            "expression": "^\\s*#define\\s+(ITEM_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/items.h"
        },
        {
            "expression": "^\\s*#define\\s+(SE_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/songs.h"
        },
        {
            "expression": "^\\s*#define\\s+(MUS_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/songs.h"
        },
        {
            "expression": "^\\s*#define\\s+(MAP_SCRIPT_\\w+)\\s+(.+)",
            "type": "define",
            "file": "include/constants/map_scripts.h"
        }
    ]
```

## Requirements

* Visual Studio Code ^1.44.0

## Release Notes

Please view the [CHANGELOG](CHANGELOG.md) for a full list of changes.

### 3.1.0

* Add command config filepath setting to support autovar commands

### 3.0.1

* Add `mart` environment to grammar
### 3.0.0

* Substitute internal typescript language service provider for [poryscript-pls](https://github.com/huderlem/poryscript-pls)
* Adds support for poryscript compiler diagnostics
* `raw` statements are now collapsable

### 2.3.0

* npm audit fix
* update include directives for modern pret-style movement constants
* Added support for assembly-style scripts (Language `poryasm`)

### 2.2.1

* Fixed broken windows paths for `readfs`client commands
* npm audit fix

### 2.2.0

* Added Completion hints and highlighting for symbols from other script files
* Added Completion hints and highlighting for custom includable files
* Added Definition Lookup Provider
* Added Icon

### 2.1.0

* Several fixes in highlighting and semantic highlighting
* Semantic highlighting for document local constants

### 2.0.0

* Experimental Semantic Highlighter

### 1.5.1

* Minor fixes and improvements

### 1.5.0

* Add constant parsing

### 1.4.1

* Minor bugfixes

### 1.4.0

* Added `poryswitch` as a completion hint
* Major bug fixes for most non-unix platforms

### 1.3.0

* Added language server capabilities

### 1.2.0

* Added Symbol name declarations to entity.name.function.pory

### 1.1.0

* Minor Fixes and Improvements.

### 1.0.0

* Initial release, support basic syntax highlighting
