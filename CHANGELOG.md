# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-24

### Added

- Desktop app for macOS, Windows and Linux with installers built on tagged releases: an Electron shell around the existing bridge and settings page. Opening the app starts the bridge and shows the settings, quitting it releases MIDI and Fairlight, and saving applies the new configuration without a terminal restart.
- Tray or menu bar icon with connection status, **Einstellungen öffnen**, **Beenden** and the optional **Bridge bei der Anmeldung starten**. Autostart is off by default and starts the app in the background without a browser window; on Linux it uses an XDG autostart entry.
- App section on the settings page with the live bridge state, session permissions for Fairlight writes and motors (off after every start) and editors for the write allowlists. Motor permission requires write permission.
- Configuration, preferences and logs moved to the platform user data directory for the app, with log rotation at 5 MB. `FAIRLIGHT_BRIDGE_DATA_DIR` and `FAIRLIGHT_BRIDGE_LOG_LEVEL` override the defaults.
- Release workflow that runs the type check, tests and build, then packages a `.dmg`, `.exe` and `.deb` and attaches them to a draft GitHub release. Generated app and tray icons need no extra dependencies.
- Optional content for the main X-Touch ten-digit seven-segment display: visible channel range, active aux in *sends on fader* mode, host clock, a Fairlight measurement and an experimental on-air mode. Configurable per main unit in the settings page; off by default, so existing setups keep an untouched display. The virtual device previews the result with real segment glyphs, and bank, aux and on-air can be tried out with simulation buttons. Character handling and digit addressing are covered by automated tests; visual verification on the device is still open.
- Fairlight measurement for the main display: integrated loudness of a main bus (`main/mainN/meters/integrated`) and the headroom reserve to 0 dB from any bus peak. Meter subscriptions also run when only the display needs them, and the bridge never resets loudness. Discovery and pushed updates are covered by tests against the mock Ember+ provider, display behaviour by the virtual MIDI backend; real live values are still to verify.
- Read-only on-air display from the documented Ember+ path `system/onair`: shown in the settings page header, in the bridge status and by `discover`. The bridge shows **unknown** when the path is missing or the connection is not freshly confirmed.
- RTP-MIDI / AppleMIDI transport per device. USB and Ethernet can be mixed, network-only setups start without the native USB MIDI module, and the settings page tests a real RTP-MIDI session. X-Touch units must run as RTP **SLAVE**.
- `soak` command and an endurance integration test that run the full stack against the mock Ember+ provider over TCP: virtual surfaces, real Ember+ client, reconnects, banking and provider pushes.
- Clearer `doctor` warning for MIDI port names shared by several devices; network devices are checked with a short session invitation.

### Safety

- Duplicate MIDI port names are now guarded. When the port list for a shared name changes at runtime, all roles using that name are locked until the bridge restarts; no MIDI, motor or Fairlight write reaches them in the meantime. The main unit with a unique name keeps working.

### Fixed

- Demo mode no longer reports the on-air state as **ON AIR**. Without a Fairlight connection the on-air badge is hidden and the API reports `onAir: null`, so a simulated setup cannot be mistaken for a live show.
- The settings page no longer shows two unconfigured spare extenders in the MIDI port lists during demo mode. It lists only the configured devices, and **Add device** reserves one new virtual port pair per added surface. Each surface still gets its own MIDI ports, and the device count stays unlimited.

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
