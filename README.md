<div align="center">

# Tune Studio

**A fast, browser-based ECU tuning suite for VEMS engine management.**

Live gauges, VE/ignition tables, curves, datalogging and firmware tools — in your browser, over Web Serial. No install required.

[![Live demo](https://img.shields.io/badge/live-demo-00e0a4?style=flat-square)](https://fixral3d.github.io/tune-studio/)
[![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-informational?style=flat-square)](./LICENSE)
[![Stack](https://img.shields.io/badge/TypeScript-React-3178c6?style=flat-square)](#tech-stack)
[![Tests](https://img.shields.io/badge/core%20tests-65-success?style=flat-square)](#testing)

**[▶ Open the live app](https://fixral3d.github.io/tune-studio/)**

</div>

---

## What is this?

**Tune Studio** is a clean-room, open alternative to the desktop VemsTune tuning application, rebuilt
from the ground up in TypeScript so it runs **entirely in the browser**. It talks to a real VEMS ECU
over the [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) (Chrome /
Edge), and ships with a full ECU **emulator** so you can explore every screen with no hardware at all.

It targets both legacy and current VEMS firmware revisions, and understands the native wire protocol,
the INI tuning dialect, tune/table/curve models, firmware containers and datalogs.

> Try it now without any hardware: open the [live app](https://fixral3d.github.io/tune-studio/) and
> pick **Demo (emulator)**.

---

## Features

- **Live gauges** — real-time dashboard driven by the ECU realtime feed.
- **3D tables** — edit VE / ignition / fuel tables with an interactive 3D surface and spreadsheet grid.
- **Curves** — 2D curve editor for warmup, enrichment, compensation and more.
- **Tune view** — browse the full firmware configuration menu tree with live, firmware-aware fields.
- **Datalogging** — record, replay and scrub `.vemslog` sessions with a timeline bar.
- **VE analyzer** — live VE auto-analysis tools and statistics.
- **Trigger log** — capture and inspect crank/cam trigger patterns.
- **Firmware files** — open `.hex` (plain Intel HEX) and `.uhex` / `.chex` (encrypted) containers; parse and inspect pages and metadata.
- **Config validation** — run firmware config validation and surface warnings/errors.
- **Command palette** — keyboard-first navigation across every panel.
- **Two transports** — connect to real hardware over **Web Serial**, or run fully offline against the built-in **emulator**.

---

## Quick start

> Requires **Node.js 18+**.

```bash
# 1. Clone
git clone https://github.com/fixral3d/tune-studio.git
cd tune-studio

# 2. Install (npm workspaces — installs every package)
npm install

# 3. Run the web app  ->  http://localhost:5173
npm run dev
```

In the app:

- **Demo (emulator)** — explore everything with no hardware.
- **Serial port (Web Serial)** — connect to a real ECU (Chrome / Edge only; requires HTTPS or `localhost`).

Other useful scripts (run from the repo root):

```bash
npm run build     # build @vems/core then the web app
npm test          # run the @vems/core test suite
npm run preview   # preview the production build locally
```

---

## Repository layout

| Path | Package | Contents |
|---|---|---|
| `packages/core` | `@vems/core` | Core engine: TriggerFrame wire protocol, ECU emulator, INI tuning model (tokenizer / preprocessor / field / value / expression engine), table/curve/tune model, firmware `.hex`/`.uhex` handling, `.vemslog`. 65 tests. |
| `apps/tuner` | `@vems/tuner` | The web UI (Vite + React): Gauges, Tables, Curves, Tune, Firmware, Datalog. |
| `apps/emu-cli` | `@vems/emu-cli` | CLI that binds the ECU emulator to a real serial port (validate against original VemsTune via com0com). |
| `re/specs` | — | Reverse-engineering **documentation**: `PROTOCOL`, `INI-DIALECT`, `FIRMWARE-*`, `FILE-FORMATS`, `FEATURE-CATALOG`, etc. |

---

## Tech stack

- **Language:** TypeScript
- **UI:** React 18 + Vite 5
- **3D:** three.js
- **Core:** zero-runtime-dependency `@vems/core` library (protocol, emulator, parsers)
- **Tests:** Vitest
- **CI/CD:** GitHub Actions → GitHub Pages

---

## Validating against the original VemsTune (com0com)

You can prove the emulator speaks the real protocol by connecting the genuine VemsTune to it through
a virtual serial pair:

1. Install [com0com](https://com0com.sourceforge.net/) and create a pair (e.g. `COM10` <-> `COM11`).
2. Run the emulator on one end:
   ```bash
   cd packages/core && npx tsc        # produce dist
   cd ../../apps/emu-cli && node src/emu.mjs --port COM10
   ```
3. In the original VemsTune, open the other end (`COM11`, 19200) and connect. The emulator answers
   detection, ECU info, page reads, realtime, writes and burn.

---

## Firmware files

`.hex` (plain Intel HEX) and `.uhex` / `.chex` (encrypted) containers are opened and parsed; pages and
metadata are shown. Encrypted firmware is **not** decrypted on the PC (neither does the original
VemsTune) — flashing to an ECU requires a session key negotiated with the device.

---

## Testing

```bash
npm test            # @vems/core — 65 tests (Vitest)
```

---

## Deployment

The web app auto-deploys to **GitHub Pages** on every push to `main` via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

The Vite `base` defaults to `/tune-studio/` for the project Pages site. To host elsewhere (root
domain, Netlify, Vercel, local static server), build with a different base:

```bash
VITE_BASE=/ npm run build
```

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Releases are tagged `vMAJOR.MINOR.PATCH`
and documented in [CHANGELOG.md](./CHANGELOG.md). Current release: **v1.0.0**.

---

## Legal & attribution

Tune Studio is an **independent, interoperability-focused** reimplementation. It is not affiliated with,
endorsed by, or derived from the VemsTune source code.

- All application and library code in `packages/` and `apps/` is original work, licensed under [MIT](./LICENSE).
- The protocol, INI dialect and file-format behaviour were determined by clean-room analysis and are
  documented in `re/specs/`.
- Some configuration/INI data files shipped under `apps/tuner/public/config/` originate from VEMS'
  publicly distributed configuration set and remain the property of their respective owners; they are
  included only so the app can interpret and display live ECU data. If you are a rights holder and want
  any file removed, please open an issue.
- Reverse-engineering build artifacts (decompiler databases, extracted binaries, capture evidence) are
  **not** redistributed and are excluded from this repository.

"VEMS" and "VemsTune" are trademarks of their respective owners.

---

## License

[MIT](./LICENSE) © fixral3d
