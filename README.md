# Poryscript Language Extension

This is a basic language extension for Poryscript. (https://github.com/huderlem/poryscript)

At this basic stage it supports basic Syntax Highlighting

## Configuration

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

## Requirements

 * Visual Studio Code 1.31.1 (January 2019)

## Known Issues

 * Extension settings are read relatively to your root workpace, therefore this does not work in a multi-workspace environment.

## Release Notes

Please view the [CHANGELOG](CHANGELOG.md) for a full list of changes.

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