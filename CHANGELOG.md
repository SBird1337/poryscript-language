# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2019-11-04

### Added
 - Add a language server that is automatically started
 - Add client extension that starts and listens to the language server
 - Add completion handler to resolve commands
 - Add signature handler to resolve command signatures and deliver signature hints
 - Add extension configuration to set command include files that can be parsed(default: `[asm/macros/event.inc]`)

## [1.2.0] - 2019-10-27

### Added

 - Symbol names are now marked as `entity.name.function.pory`
 - `local` and `global` in symbol declarations are marked as `keyword.other.pory`

## [1.1.0] - 2019-10-24

### Added

- Keywords: `raw`
- Constants: `true`, `false`, `TRUE`, `FALSE`
- raw `` ` ` `` sections are now treated as a string section

### Changed

- Extension requires Visual Studio Code version `^1.31.1` (was `^1.39.0`)
- Scope name changed to `pory`

### Fixed

- Auto-Closing/Surrounding pairs now correctly use \` instead of ''
- Changed every scope name suffix to `pory` consistantly

## [1.0.0] - 2019-10-24

- Initial release
