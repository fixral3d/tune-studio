# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-01

First public release.

### Added
- **`@vems/core`** — TriggerFrame wire protocol, ECU emulator, INI tuning model
  (tokenizer / preprocessor / field / value / expression engine), table/curve/tune
  model, firmware `.hex` / `.uhex` / `.chex` container handling, `.vemslog` support. 65 tests.
- **`@vems/tuner`** — browser web app (Vite + React): live gauges, 3D VE/ignition
  tables, curve editor, tune menu tree, datalog record/replay, VE analyzer, trigger
  log, firmware file inspector, config validation and a command palette.
- **`@vems/emu-cli`** — CLI that binds the emulator to a serial port for protocol
  validation against the original VemsTune via com0com.
- **Two transports** — Web Serial (real hardware) and a built-in offline emulator.
- Reverse-engineering specifications under `re/specs/`.
- GitHub Pages deployment via GitHub Actions.
- SEO metadata, README, LICENSE (MIT) and semantic versioning.

[1.0.0]: https://github.com/fixral3d/tune-studio/releases/tag/v1.0.0
