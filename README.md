# Fairlight X-Touch Bridge

[![CI](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/cedricbetke/fairlight-xtouch-bridge/actions/workflows/ci.yml)

A control bridge between Behringer X-Touch control surfaces and Blackmagic Design **Fairlight Live**. The bridge translates MIDI from the X-Touch (Mackie Control / MC mode) into Fairlight's Ember+ interface and back, so faders, mutes, pan, meters, channel names and a few function keys work on the physical surface.

The bridge carries **control data only**. It does not process or route audio and does not change the Fairlight audio routing.

> **Status:** Working software for a specific setup: macOS, Fairlight Live 1.1.1, one X-Touch and two X-Touch Extenders. Core functions were verified on real hardware on 22 Nov 2026; some features are only covered by automated tests so far. See [Status](#status) and [Hardware Testing](docs/hardware-test.md).

This project is not affiliated with, endorsed by, or sponsored by Blackmagic Design or Behringer.

## Features

- **Faders** in both directions with 14-bit MCU values, a measured fader curve, and touch protection: the motor stops while you hold a fader.
- **Mute** with LED feedback that follows the confirmed Fairlight state, not the button press.
- **Flexible channel mapping:** eight strips per surface, with fixed assignments or shared banking in steps of the bank width. One X-Touch as the main unit, plus additional extenders.
- **Master fader** on a configurable main or bus.
- **LCD channel names** read from Fairlight, with configurable background colors and text lines, plus per-channel overrides.
- **Pan** on the encoders (press to center), with LED rings that follow Fairlight.
- **Signal meters** on the LED strips, switchable per device.
- **Sends on Fader** for one aux bus, switched with the `SEND` button.
- **Assignable keys** (F1–F8 and the right-hand keys on the main unit) that can be set to *Sends on Fader* (choose an aux) or *Monitor-Dim* (choose a monitor path).
- **Settings page** in the browser for device order, fixed or banking assignment, USB ports, encoder and meter options, LCD layout and button assignments. Available in German and English.
- **Startup diagnostics** (`doctor`) that check MIDI ports, Fairlight targets and write permissions without sending anything.
- **Simulation** with virtual MIDI devices and a mock Fairlight client, so you can try the software without hardware.

Not supported: Select, Solo/PFL, and plugin control, because there is no verified Ember+ interface for them. Network MIDI (RTP-MIDI) is prepared in the settings page but not implemented yet. See the [Roadmap](docs/roadmap.md).

## Requirements

- macOS 15 Sequoia or newer on Apple Silicon, with Fairlight Live 1.1.1. Hardware testing was done on macOS 26.
- Node.js **26 LTS** (26.0 or newer). Node.js 22 is not supported by the Ember+ library in use.
- An X-Touch and, optionally, one or more X-Touch Extenders, each set to **MC** mode. Use a separate USB path for each unit.
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
- **Fairlight is the source of truth.** Mute LEDs, motor positions, pan rings and dim LEDs follow confirmed Fairlight values. A successful send alone does not count as confirmation.
- **Stale values expire** after `safety.writeExpiryMs` (250 ms by default). Bank changes, structure changes and disconnects discard pending writes.
- **Failed writes lock the strip** until Fairlight reports a fresh value for that field and you touch the fader again.
- **Structure changes lock immediately** and are picked up automatically after successful rediscovery.

Details: [Configuration → Safety](docs/configuration.md#safety).

## Command line

```text
bridge run --config <file> [--arm-motor] [--arm-writes] [--pretty]
bridge discover [--config <file>] [--host <ip>] [--port <n>] [--json]
bridge doctor [--config <file>] [--host <ip>] [--port <n>] [--skip-midi] [--skip-fairlight] [--json]
bridge midi list [--config <file>]
bridge midi monitor [--config <file>] [--device main|extender1|extender2] [--duration <s>]
bridge simulate [--pretty]
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
| Pan on encoders, LED rings | Implemented and automatically tested; not yet checked on the devices |
| Meters on LED strips | Implemented and automatically tested; not yet checked on the devices |
| Sends on Fader (one aux) | Implemented and automatically tested; not yet checked in a live show |
| F1–F8 and right-hand main keys with *Sends on Fader* and *Monitor-Dim* | Implemented and automatically tested; not yet checked in a live show. LED feedback of the right-hand keys is unverified on the device |
| Bus assignment for faders (fixed) | Implemented and automatically tested; bus LED feedback not yet checked in a live show |
| Hotplug and Fairlight reconnect | Implemented; verified on the studio Mac |
| Settings page with device list and LCD preview | Implemented; tested with virtual devices and headless Chrome |
| Language switch for the settings page (German/English) | Implemented; translations automatically tested, switching checked in headless Chrome |
| `doctor` startup diagnostics | Implemented and automatically tested |
| VCA/DCA | Best-effort only; Fairlight's documented Ember+ structure does not list DCA targets |
| Select, Solo/PFL, plugin control | Not implemented; no verified Ember+ interface |
| Network MIDI (RTP-MIDI) | Prepared in the settings page; transport not implemented |
| Autostart with launchd | Example provided; not tested on macOS |
| Long-running operation, sleep/wake | Not yet tested |

## Known limitations

- **Fader curve:** Measured on one X-Touch. Other units or firmware versions may need a new measurement. The motor end stops do not reach the last millimeters.
- **MIDI port identity:** Ports are matched by exact name plus an occurrence index. Two extenders report the same name, so their order can change after re-plugging. Test each fader after connecting and swap occurrences if needed. Put each extender on its own USB path; a USB cascade through an extender's hub produced duplicate or silent ports in testing.
- **Channel identity:** Fairlight does not expose a stable channel ID. Strips follow Ember+ channel numbers and the current order in the show. Do not reorder channels during a live show.
- **Single-channel test mode:** `mapping.singleChannelName` should match the channel name exactly, and the name must be unique in the show.

See [Roadmap](docs/roadmap.md) for the full list.

## Project layout

```text
src/
  cli.ts                 command line interface and signal handling
  config.ts              configuration schema and validation
  logger.ts              structured JSON logs
  midi/                  port resolution, hotplug, native and virtual MIDI backends
  mcu/                   MCU codec, 14-bit faders, LEDs, LCD and meter encoding
  fairlight/             Ember+ client, dynamic discovery, mock client and mock provider
  mapping/               channel mapping and banking
  sync/                  touch protection, write scheduler, motor and LED synchronization
  runtime/               wiring of components, doctor
  sim/                   virtual MCU surface and acceptance scenario
  settings/              local HTTP API, demo configuration, config storage
test/                    unit and integration tests
web/                     settings page (HTML, CSS, JavaScript, fonts)
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

The test suite covers the MCU codec, the fader curve, LCD text and colors, configuration validation, channel mapping for fixed and banking layouts, fader and mute sync, pan and meter behavior, the settings API, the Ember+ client against a local mock provider, and the doctor checks. The `simulate` command runs an acceptance scenario with virtual devices.

## License

Code in this repository is licensed under the [MIT License](LICENSE). Third-party dependencies and reference projects are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The bundled web fonts are under the SIL Open Font License 1.1.

Fairlight Live manuals and release notes are copyright Blackmagic Design. They are referenced for protocol facts and are not redistributed here.
