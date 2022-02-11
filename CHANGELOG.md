# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2022-02-11

### Fixed

 * npm audit fix
 * movement constant loading updated for modern pret-style repositories

### Added

 * Language Support for assembly style scrips (Language `Poryasm`)

## [2.2.1] - 2021-10-09

### Fixed

* npm audit fix
* broken windows paths (#19, #18)

## [2.2.0] - 2021-07-06

### Added

* An icon
* Symbol lookup in other poryscript files for highlighting and completion hints
* Customizable token lookup in .h and .inc files for highlighting and completion hints
* Definition lookup provider

### Changed

* Build order of semantic highlighter sorted by character index in line

## [2.1.0] - 2021-07-05

### Added

* Semantic highlighting for document local constants

## Fixed

* Semantic Highlighting in other tokens, strings and comments
* `poryswitch` keyword in `text` sections

## [2.0.0] - 2021-05-31

### Added

* Experimental Support for Sematic Highlighter

### Breaking

* Visual Studio Code minimum required version was changed to `^1.44.0`.

### Fixed

* Fixed missing syntax highlighting (#14)

## [1.5.2] - 2019-11-26

### Fixed

* Fixed a bug that caused comments not to render inside of sections.

## [1.5.1] - 2019-11-26

### Changed

* Content of the `raw` directive is now rendered as `source.arm.embedded`.
* Constants are correctly highlighted
* String escapes wrapped in `{}` are correctly marked as escape characters.

### Fixed

* Refractored the syntax highlighting s.t. highlighting is more aware of its context

## [1.5.0] - 2019-11-05

### Added

* Added parsing for constants and movement constants

### Fixed

* Fixed a bug that caused completion hint cache not to immediately update when a poryscript document is opened

### Changed

* Changed default value for `languageServerPoryscript.commandIncludes` to `["asm/macros/event.inc", "asm/macros/movement.inc"]`

## [1.4.1] - 2019-11-05

### Fixed

* Fixed a bug that caused completion hint cache not to clear when changing the settings
* Fixed a bug that caused completion hint cache not to immediately update when changing watched files

## [1.4.0] - 2019-11-05

### Added

* Add support for `poryswitch` compile time switch statement

### Fixed

* Removed the `deasync` dependency which caused the extension not to run on most platforms
* Fixed a bug that caused reading documents to fail on non-unix like platforms
 
### Changed

* Language server features that call async functions are now itself async

## [1.3.0] - 2019-11-04

### Added

* Add a language server that is automatically started
* Add client extension that starts and listens to the language server
* Add completion handler to resolve commands
* Add signature handler to resolve command signatures and deliver signature hints
* Add extension configuration to set command include files that can be parsed(default: `[asm/macros/event.inc]`)

## [1.2.0] - 2019-10-27

### Added

* Symbol names are now marked as `entity.name.function.pory`
* `local` and `global` in symbol declarations are marked as `keyword.other.pory`

## [1.1.0] - 2019-10-24

### Added

* Keywords: `raw`
* Constants: `true`, `false`, `TRUE`, `FALSE`
* raw `` ` ` `` sections are now treated as a string section

### Changed

* Extension requires Visual Studio Code version `^1.31.1` (was `^1.39.0`)
* Scope name changed to `pory`

### Fixed

* Auto-Closing/Surrounding pairs now correctly use \` instead of ''
* Changed every scope name suffix to `pory` consistantly

## [1.0.0] - 2019-10-24

* Initial release
