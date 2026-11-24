# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-24

First public pre-release of the Fairlight X-Touch Bridge.

### Added

- Control of Fairlight Live over Ember+ from Behringer X-Touch and X-Touch Extenders in MC mode.
- Bidirectional faders with 14-bit MCU values, a measured fader curve and touch protection.
- Mute with LED feedback from the confirmed Fairlight state, not from the button press.
- Fixed and banking channel mapping across any number of surfaces, plus a master fader on a main or bus.
- LCD channel names, type colors, configurable text lines and per-target overrides with short names.
- Pan on the encoders with LED rings, and signal meters on the LED strips, switchable per device.
- Sends on Fader for one aux bus, and function-key assignments for *Sends on Fader* and *Monitor-Dim*.
- Local settings page in German and English: device order, targets, LCD preview, port diagnostics and find.
- `doctor` startup diagnostics without writing to Fairlight, plus `discover`, `midi`, `settings`, `simulate` and `mock-ember` commands.
- Simulation with virtual MIDI devices and a mock Fairlight provider, so the software can be tried without hardware.
- GitHub Actions CI running the type check, the test suite and the build on Node.js 26.

### Safety

- Writes and motor movement are off unless explicitly armed and allow-listed.
- Pending values expire, and bank changes, structure changes and disconnects discard them.
- A failed or unconfirmed write locks the affected strip until Fairlight reports a fresh value.

### Verified with hardware

Fairlight Live 1.1.1 on macOS with one X-Touch and two X-Touch Extenders: faders, mutes, master, banking, startup and bank alignment, LCD names, MIDI hotplug, structure changes and Fairlight reconnect. See [Hardware Testing](docs/hardware-test.md).

### Not yet verified on hardware

Pan direction and ring mode, meter segmentation, LCD colors and line modes, Sends on Fader and Monitor-Dim in a live show, long-running operation, sleep/wake and the launchd autostart. See the [roadmap](docs/roadmap.md).

### Not supported

Select, Solo/PFL and plugin control have no verified Ember+ interface. Network MIDI (RTP-MIDI) is prepared in the settings page but not implemented.
