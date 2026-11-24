# Fairlight X-Touch Bridge

[![CI](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/ci.yml)
[![Release](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/release.yml/badge.svg)](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/release.yml)

A control bridge between Behringer X-Touch control surfaces and Blackmagic Design **Fairlight Live**. The bridge translates MIDI from the X-Touch (Mackie Control / MC mode) into Fairlight's Ember+ interface and back, so faders, mutes, pan, meters, channel names and a few function keys work on the physical surface.

The bridge carries **control data only**. It does not process or route audio and does not change the Fairlight audio routing.

> **Status:** Working software for a specific setup: macOS, Fairlight Live 1.1.1, one X-Touch and two X-Touch Extenders. Core functions were verified on real hardware on 22 Nov 2026; some features are only covered by automated tests so far. See [Status](#status) and [Hardware Testing](docs/hardware-test.md).

This project is not affiliated with, endorsed by, or sponsored by Blackmagic Design or Behringer.

## Install the app

Download the installer for your platform from [Releases](https://github.com/cedricbetke/fairlight-xtouch-bridge/releases):

| Platform | Installer | Status |
|---|---|---|
| macOS 15+ on Apple Silicon | `.dmg` | Primary target, tested with real hardware |
| Windows 10/11 (x64) | `.exe` | Preview until USB MIDI is verified on Windows |
| Ubuntu/Debian (x64) | `.deb` | Preview until USB MIDI is verified on Linux |

The app bundles its own runtime. Git, Node.js, npm and the terminal are not required. Open the app, configure the devices in the browser page and press **Speichern**; the bridge starts with the saved configuration. It runs until you quit the app through the tray or menu bar icon, where you also find **Einstellungen öffnen** and the optional autostart.

- **Autostart** is off by default and can be enabled in the app section or the tray menu. It starts the app in the background without a browser window.
- **Fairlight writes and motors** are off after every launch and must be enabled for the session. Targets also need explicit entries in the write allowlists.
- Configuration, preferences and logs live in the user data directory (`~/Library/Application Support/Fairlight X-Touch Bridge`, `%APPDATA%\Fairlight X-Touch Bridge` or `~/.config/fairlight-xtouch-bridge`).

Details, uninstall notes and local packaging: [Desktop App](docs/desktop-app.md).

## Features

- **Faders** in both directions with 14-bit MCU values, a measured fader curve, and touch protection: the motor stops while you hold a fader.
- **Mute** with LED feedback that follows the confirmed Fairlight state, not the button press.
- **Flexible channel mapping:** eight strips per surface, with fixed assignments or shared banking in steps of the bank width. One X-Touch as the main unit, plus additional extenders.
- **USB or Ethernet per device:** every unit can run on USB or as an RTP-MIDI session (AppleMIDI). Mixed setups such as a USB main unit with Ethernet extenders are supported, and a network-only setup starts without the native USB MIDI module.
- **Master fader** on a configurable main or bus.
- **LCD channel names** read from Fairlight, with configurable background colors and text lines, plus per-channel overrides.
- **Main-unit display:** the ten-digit seven-segment display can show the visible channel range, the active aux, the host clock, a Fairlight measurement or the on-air state. The measurement mode reads the integrated loudness of a main bus or the headroom reserve of any bus directly from Ember+. Configurable per main unit; off by default. The settings page previews the result on the virtual device with real segment glyphs, including bank, aux and on-air simulation.
- **Pan** on the encoders (press to center), with LED rings that follow Fairlight.
- **Signal meters** on the LED strips, switchable per device.
- **On-air indicator:** read-only state from Ember+ `system/onair` in the settings page header and in `discover`. Shows *unknown* when the path is missing or the connection is not freshly confirmed; it never switches the state.
- **Duplicate port guard:** when two devices share a MIDI port name and that port list changes, both lock until the bridge restarts instead of risking a write to the wrong unit.
- **Sends on Fader** for one aux bus, switched with the `SEND` button.
- **Assignable keys** (F1–F8 and the right-hand keys on the main unit) that can be set to *Sends on Fader* (choose an aux) or *Monitor-Dim* (choose a monitor path).
- **Settings page** in the browser for device order, fixed or banking assignment, USB ports, encoder and meter options, LCD layout and button assignments. Available in German and English.
- **Startup diagnostics** (`doctor`) that check MIDI ports, Fairlight targets and write permissions without sending anything.
- **Simulation** with virtual MIDI devices and a mock Fairlight client, so you can try the software without hardware.

Not supported: Select, Solo/PFL, and plugin control, because there is no verified Ember+ interface for them. Over Ethernet the bridge works as RTP-MIDI initiator only: the X-Touch must run as RTP **SLAVE**, and Bonjour discovery and Ethernet *Find* are not implemented. See the [Roadmap](docs/roadmap.md).

## Requirements

- **Desktop app:** macOS 15 Sequoia or newer on Apple Silicon (primary target), Windows 10/11 x64 or Ubuntu 22.04/Debian 12 x64 as preview. The app includes its own runtime.
- **From source:** macOS 15 Sequoia or newer on Apple Silicon, with Fairlight Live 1.1.1. Hardware testing was done on macOS 26.
- Node.js **26 LTS** (26.0 or newer) for the command line and development. Node.js 22 is not supported by the Ember+ library in use. The packaged app runs on Electron's bundled runtime; the full simulation passes there as well.
- An X-Touch and, optionally, one or more X-Touch Extenders, each set to **MC** mode. Use a separate USB path for each unit, or connect a unit over Ethernet in **MC → NETWORK** mode with RTP **SLAVE**. Each network unit needs its own IP address and a free UDP port pair (control port and control port + 1, default 5004/5005).
- Ember+ enabled in Fairlight Live: **File → Show Settings → Ember+ → Enable**.

## Quick start (no hardware needed)

```bash
git clone https://github.com/cedricbetke/fairlight-xtouch-bridge.git
cd fairlight-xtouch-bridge
npm ci
npm run build
npm test
npm run settings:demo
```

Then open <http://127.0.0.1:8787> to explore the settings page with three virtual X-Touch units and 40 demo channels. To run the full simulation scenario instead:

```bash
npm run dev -- simulate
```

To run the desktop app from source instead of the command line:

```bash
npm run app
```

## Using real hardware

1. Follow the [Getting Started guide](docs/setup.md). It covers installation, Ember+ setup, MIDI port mapping, the single-channel configuration file and a safe first test.
2. Run the startup check on that file before you arm anything:
   ```bash
   npm run dev -- doctor --config config/bridge.poc.json
   ```
3. Start the bridge with explicit permission to write to Fairlight and move motors:
   ```bash
   npm run dev -- run --config config/bridge.poc.json --arm-motor --arm-writes --pretty
   ```

The guide's last section moves on from there to the full configuration (`config/bridge.json`).

Nothing is written to Fairlight unless you pass `--arm-writes` **and** the target is in the write allowlist. Motors move only when `--arm-motor` is given as well.

## Documentation

| Document | Contents |
|---|---|
| [Desktop App](docs/desktop-app.md) | Installers, first start, tray, autostart, permissions, data locations |
| [Getting Started](docs/setup.md) | Installation, Ember+ setup, MIDI ports, first hardware test |
| [Configuration](docs/configuration.md) | Devices, banking, fixed targets, LCD, function keys, safety settings |
| [Troubleshooting](docs/troubleshooting.md) | Port problems, duplicate extender names, reconnects, read-only targets |
| [Hardware Testing](docs/hardware-test.md) | Acceptance tests and the results from the studio Mac |
| [Roadmap](docs/roadmap.md) | Must-have, optional and deferred features, known hardware limits |
| [Technical Reference](docs/research.md) | Ember+ and MCU protocol notes, sources and what was verified |
| [Contributing](CONTRIBUTING.md) | Project layout, local tests, and guidelines for changes |

Protocol references: [Ember+ API](docs/protocols/Fairlight_Live_EmberPlus_API.md) · [X-Touch USB](docs/protocols/XTouch_USB_MCU_Referenz.md) · [X-Touch Ethernet](docs/protocols/XTouch_Ethernet_MCU_Referenz.md) · [Extender USB](docs/protocols/XTouch_Extender_USB_MCU_Referenz.md) · [Extender Ethernet](docs/protocols/XTouch_Extender_Ethernet_MCU_Referenz.md)

Release history: [CHANGELOG.md](CHANGELOG.md).

## Safety model

- **Writes are off by default.** `--arm-writes` is required, and each target must be listed in `safety.allowedWriteChannels`, `allowedWriteBuses` or `allowedWriteMonitors`.
- **Motors are off by default.** `--arm-motor` is required together with `--arm-writes`, and the strip's target must be in the write allowlist.
- **Touch protection.** Fader movement without touch is ignored while `safety.requireTouchForWrites` is on.
- **Fairlight is the source of truth.** Mute LEDs, motor positions, pan rings and dim LEDs follow confirmed Fairlight values. A successful send alone does not count as confirmation. On-air is displayed only when freshly confirmed; otherwise it is unknown.
- **Stale values expire** after `safety.writeExpiryMs` (250 ms by default). Bank changes, structure changes and disconnects discard pending writes.
- **Failed writes lock the strip** until Fairlight reports a fresh value for that field and you touch the fader again.
- **Structure changes lock immediately** and are picked up automatically after successful rediscovery.
- **Duplicate port names fail safe.** If the port list for a name used by several roles changes at runtime, those roles lock until the bridge restarts. The main unit with a unique name keeps working.
- **Transport does not change safety.** USB and Ethernet use the same arming, allowlists, touch protection and confirmation rules. A network session only carries MCU traffic.

Details: [Configuration → Safety](docs/configuration.md#safety).

## Command line

```text
bridge run --config <file> [--arm-motor] [--arm-writes] [--pretty]
bridge discover [--config <file>] [--host <ip>] [--port <n>] [--json]
bridge doctor [--config <file>] [--host <ip>] [--port <n>] [--skip-midi] [--skip-fairlight] [--json]
bridge midi list [--config <file>]
bridge midi monitor [--config <file>] [--device main|extender1|extender2] [--duration <s>]
bridge simulate [--pretty]
bridge soak [--seconds <n> | --minutes <n>] [--channels <n>] [--log-level <level>] [--pretty]
bridge mock-ember [--port <n>] [--channels <n>]
bridge settings [--config <file>] [--port <n>] [--demo] [--no-discover]
bridge config validate --config <file>
```

Run them with `npm run dev -- <command>` from source, or `npm start -- <command>` after `npm run build`. Logs are JSON lines on stderr (`--pretty` for readable output). Command output goes to stdout.

## Status

| Area | Status |
|---|---|
| Ember+ discovery of channels, buses, names, faders, mute and pan | Implemented; verified against a real Fairlight provider |
| Fader sync with 14-bit values, touch protection, mute LEDs | Implemented; verified on the studio Mac with 24 channels |
| 8/16/24-strip mapping (main + two extenders), banking, master | Implemented; verified on the studio Mac with one X-Touch and two extenders |
| LCD channel names, including bank changes and renames | Implemented; verified on main and both extenders |
| LCD colors and text line modes | Implemented and automatically tested; not yet checked on the devices |
| Main-unit ten-digit display (channel range, aux, clock, Fairlight measurement, on-air) | Implemented and automatically tested against a virtual MIDI backend and the mock Ember+ provider; digits, dots, words and the loudness sign not yet checked on the device. Live Ember+ loudness values still to verify with a real show |
| Pan on encoders, LED rings | Implemented and automatically tested; not yet checked on the devices |
| Meters on LED strips | Implemented and automatically tested; not yet checked on the devices |
| Sends on Fader (one aux) | Implemented and automatically tested; not yet checked in a live show |
| F1–F8 and right-hand main keys with *Sends on Fader* and *Monitor-Dim* | Implemented and automatically tested; not yet checked in a live show. LED feedback of the right-hand keys is unverified on the device |
| Bus assignment for faders (fixed) | Implemented and automatically tested; bus LED feedback not yet checked in a live show |
| Hotplug and Fairlight reconnect | Implemented; verified on the studio Mac |
| Duplicate MIDI port names | Implemented and automatically tested: a changed port list locks the affected roles until restart. Real USB replug test on the Mac still pending |
| On-air display (`system/onair`, read-only) | Implemented and automatically tested against the mock provider. Real Fairlight push behavior still to check |
| Endurance over the real Ember+ path | Full-stack test and `soak` command included; multi-hour run on the Mac still pending |
| Settings page with device list and LCD preview | Implemented; tested with virtual devices and headless Chrome |
| Desktop app for macOS, Windows and Linux | Implemented: Electron shell with tray, in-place bridge restarts, session permissions and optional autostart. The Windows package starts and serves the settings page; real USB MIDI through the packaged app and the macOS/Linux packages are still to verify |
| Language switch for the settings page (German/English) | Implemented; translations automatically tested, switching checked in headless Chrome |
| `doctor` startup diagnostics | Implemented and automatically tested |
| VCA/DCA | Best-effort only; Fairlight's documented Ember+ structure does not list DCA targets |
| Select, Solo/PFL, plugin control | Not implemented; no verified Ember+ interface |
| Network MIDI (RTP-MIDI / AppleMIDI) | Implemented as initiator with mixed USB/network setups; tested against local mock peers and covered by unit, protocol and full-stack tests. Real X-Touch Ethernet test still pending. RTP **SLAVE** only; no Bonjour or Ethernet *Find* |
| Autostart with launchd | Example provided; not tested on macOS |
| Long-running operation, sleep/wake | Not yet tested |

## Known limitations

- **Fader curve:** Measured on one X-Touch. Other units or firmware versions may need a new measurement. The motor end stops do not reach the last millimeters.
- **MIDI port identity:** Ports are matched by exact name plus an occurrence index. Two extenders report the same name, so their order can change after re-plugging. Test each fader after connecting and swap occurrences if needed. Put each extender on its own USB path; a USB cascade through an extender's hub produced duplicate or silent ports in testing.
- **Ethernet identity:** A network device is addressed by its configured IP address and control port, so no occurrence mapping is needed. The unit must run as RTP **SLAVE**. The bridge does not implement the RTP-MIDI recovery journal and ignores incoming journals; verify this on the real hardware. Do not run two bridges or a second MIDI session against the same unit at the same time.
- **Channel identity:** Fairlight does not expose a stable channel ID. Strips follow Ember+ channel numbers and the current order in the show. Do not reorder channels during a live show.
- **Single-channel test mode:** `mapping.singleChannelName` should match the channel name exactly, and the name must be unique in the show.

See [Roadmap](docs/roadmap.md) for the full list.

## Project layout

```text
src/
  cli.ts                 command line interface and signal handling
  app/                   desktop app: Electron shell, tray, lifecycle, autostart
  config.ts              configuration schema and validation
  logger.ts              structured JSON logs
  midi/                  port resolution, hotplug, native and virtual MIDI, RTP-MIDI sessions, mock peer
  mcu/                   MCU codec, 14-bit faders, LEDs, LCD and meter encoding
  fairlight/             Ember+ client, dynamic discovery, mock client and mock provider
  mapping/               channel mapping and banking
  sync/                  touch protection, write scheduler, motor and LED synchronization
  runtime/               wiring of components, doctor
  sim/                   virtual MCU surface, acceptance scenario, hardware-free soak
  settings/              local HTTP API, demo configuration, config storage
test/                    unit and integration tests
web/                     settings page (HTML, CSS, JavaScript, fonts)
assets/                  app and tray icons
scripts/                 icon generator
config/                  example configurations
deploy/                  launchd example
docs/                    guides, hardware tests, roadmap, protocol references
```

## Tests

```bash
npm run check   # TypeScript in strict mode
npm test        # node:test with tsx
npm run build
```

The test suite covers the MCU codec, the fader curve, LCD text and colors, configuration validation, channel mapping for fixed and banking layouts, fader and mute sync, pan and meter behavior, the settings API, the Ember+ client against a local mock provider, the doctor checks, the duplicate-port guard, the on-air display, the AppleMIDI/RTP-MIDI packet and session layer, and a mixed USB/Ethernet bridge run. The `simulate` command runs an acceptance scenario with virtual devices. The endurance test runs the full stack over TCP — virtual surfaces, real Ember+ client, mock provider — including banking, feedback and reconnect safety.

For a longer, hardware-free run before a studio session:

```bash
npm run dev -- soak --minutes 30
```

`soak` keeps the full bridge running with randomized faders, mutes, banking, provider restarts and extender replugs, prints a status line every 10 seconds and a summary at the end. It touches no real MIDI ports and no real Fairlight, and exits with code 1 if an invariant fails.

## License

Code in this repository is licensed under the [MIT License](LICENSE). Third-party dependencies and reference projects are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The bundled web fonts are under the SIL Open Font License 1.1.

Fairlight Live manuals and release notes are copyright Blackmagic Design. They are referenced for protocol facts and are not redistributed here.
