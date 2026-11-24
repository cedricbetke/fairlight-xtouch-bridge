# Roadmap

As of 23 Nov 2026. Based on the protocol references under [`docs/protocols/`](protocols/), the measurements from [`docs/research.md`](research.md), and the current code. The bridge's goal is a live mixing surface for Fairlight Live, not a replacement for the full Fairlight interface. An X-Touch key that the bridge detects is not yet a function that Fairlight executes.

The lists are divided into **Must have**, **Optional** and **Not needed / deferred**. "Must have" means: without these items, the bridge is not approved for live use.

## Completed (22 Nov 2026)

- **24 channels + master:** Faders, mutes, banking, start and bank alignment verified on the studio Mac.
- **LCD channel names:** Channel names on main and both extenders, including bank change and renaming.
- **Structure and reconnect behavior:** Short lock, automatic adoption without restart.
- **Fader curve:** measured on an X-Touch, stored as a piecewise linear curve.
- **Encoder/Pan and level displays (code):** Encoders write pan, press resets to center, LED ring and meters follow Fairlight. Switchable per device. Automated tests; hardware visual check pending.
- **Dynamic device list (code):** Devices can be added, sorted, disabled and removed in the UI; the first free USB port is taken over automatically. More than three devices extend banking. Automated tests.
- **Simulation extended (23 Nov 2026):** The acceptance run checks 40 channels across two banks, including pan rings, level displays and encoder targets after a bank change. A second run combines a fixed assignment with a fixed aux fader and banking extenders and checks fader, mute, pan, meters and bank change on the fixed bus. The mock client accepts freely definable buses for this. A third run disconnects Fairlight and an extender while a fader value is still pending, and checks that pending values are discarded, level displays go off, and the reconnect only adopts fresh Fairlight values.
- **Monitor-Dim on assignable keys (24 Nov 2026):** Monitor paths are detected and subscribed via Ember+. A freely assigned key switches `monitor/monitorN/dim`; the LED follows only the confirmed state and goes off after a disconnect. Write access must be enabled via `safety.allowedWriteMonitors`. Automated tests; acceptance on a real show pending.
- **Startup diagnostics (24 Nov 2026):** `doctor` checks in one run MIDI ports, Fairlight detection, fixed targets, sends-on-fader, key assignments and write enables. Output as `OK`/`WARN`/`FAIL`, optionally JSON; no MIDI output and no write access. Automated tests.

## Must have – for live use

| Feature | Status / open item |
|---|---|
| **Faders and master fader** with touch protection and motor feedback from confirmed Fairlight values | Verified on the studio Mac with main and two extenders. |
| **Mute with LED feedback** | Verified on the device for input channels. Mute and LED feedback for fixed-assigned buses are implemented, but not yet approved with a real show. |
| **Banking, fixed channel/bus mapping and LCD names** | Banking and names verified on the device. Fixed bus mapping including level and mute still to be approved on the device. |
| **Pan with LED ring, channel and bus level displays** | Implemented and automatically tested. On the main and extenders, still check encoder direction, ring mode, ring positions and meter segmentation. |
| **Approve pan and level on the device** | Adjust ring mode and meter curve if deviations occur. |
| **Safe operation with USB hotplug, Fairlight reconnect and show changes** | Basic behavior verified. Open: multi-hour continuous operation and reliable detection of same-named extenders after replugging. |
| **Continuous operation** | Multi-hour test with 24 channels, banking, structure changes and reconnects; log review for timeout/retry storms. |
| **Sleep/Wake and launchd** | Check behavior after sleep and autostart on macOS. |

## Optional – if it improves the workflow

| Feature | Recommendation |
|---|---|
| **Aux sends via the encoders** | Next sensible expansion: select an aux and adjust the send level per channel. Ember+ documents the paths (`<source>/sends/aux/auxA/{level,mute,pan}`); check writability and feedback first in a real show. Send mute/pan as well as mix-minus and matrix sends only if needed. **Sends on fader for a fixed aux is implemented**; encoder variant and multiple aux targets are still pending. |
| **Aux send mode at the console** | **Partially implemented:** `SEND` sets the faders to the configured aux, `PAN` switches back; the aux can be selected on the settings page. Simulated: mode switch with pending write, reconnect in SEND mode and missing sends. Open: selecting multiple aux targets at the console, display of send mute, and an encoder variant. |
| **Free key assignment on the X-Touch** | **Partially implemented:** Device cards show main and extenders as small top views; the gear icon opens the large view, where F1–F8 and the right-hand main keys can be assigned by clicking (action types: sends on fader with aux selection, Monitor-Dim with monitor selection). `BANK`, `CH`, `SEND`, `PAN/SURR` and `FLIP` remain fixed reserved; the modifiers cannot be assigned. Feedback: active key lights up, LCD shows `AUX n`. Open: Fairlight shortcuts, mute groups, further action types, and LED check of the right-hand keys on the real device. |
| **Bridge actions for keys** | **Partially implemented:** Sends on fader with aux target switch. Open: pan/further aux targets, LCD toggling between name and value. |
| **Fairlight actions for keys** | **Partially implemented:** Switch monitor path to Dim; the key shows the confirmed dim state. Open: monitor level and monitor mute on keys. Offer channel cue/PFL only once command and feedback are verified. |
| **Fairlight keyboard shortcuts on assignable keys** | Assign a keyboard shortcut in Fairlight Live and map it to a free X-Touch key in the key editor (new action type "Fairlight shortcut"). A local helper on the Mac only triggers the shortcut when Fairlight Live is in the foreground; the bridge itself sends no Ember+ in this case. Prerequisite: macOS Accessibility permission and a shortcut verified on the Mac. Without a separate Fairlight feedback, the key LED shows no confirmed state. Trigger only after deliberate assignment, never as automatic keystroke input. Optional; check on the studio Mac first. |
| **SOLO as channel cue** | `SOLO` should preview the currently banked channel (PFL/AFL) without changing the program mix, and the LED should show the actual Fairlight status. A verified channel-related PFL/AFL command in Ember+ is missing for this; first check Fairlight's OSC interface. Not to be confused with the Ember+ cue player, which starts prepared audio/MIDI cues. |
| **Jog/Shuttle as "Touch & Turn"** | Hold the encoder on the desired channel and turn the jog: in PAN mode this changes the pan, in SEND mode the level to the selected aux. On release the jog loses its target, so that after a bank change the wrong channel is not adjusted. In this combination, the encoder press must not simultaneously center the pan. A Fairlight fader clicked with the mouse cannot be reliably addressed without an interface for UI focus. |
| **VCA/DCA on faders** | Useful when mixing via groups. The code searches best-effort for `vca`/`dca`, but the paths are not documented. Only check with a show that actually contains VCAs. |
| **SELECT and SOLO/PFL per channel** | The bridge detects the key presses; a Fairlight Ember+ path is not verified. For SOLO, see the channel cue item above; SELECT remains open. The SELECT LED flashing to find the device is independent of this. |
| **LCD colors and second line** | Implemented and automatically tested; including freely combinable lines with confirmed fader value in dB and active fader target. Visual check of color codes and line modes on main and extenders pending. Correct channel names are more important for approval than colors. |
| **Ethernet/RTP-MIDI instead of USB** | Useful with long cable runs or recurring USB problems. The settings are prepared, the actual transport is missing. If Ethernet is set for the setup, this item becomes a must-have. |
| **Further monitor paths** | Four monitor paths with level, mute, dim and meter. Monitor 1 additionally provides integrated loudness and true peak. **Monitor-Dim can be switched via assigned keys**; level, mute and meters of the monitors, as well as a separate loudness display, are still pending. |
| **On-air display** | `system/onair` initially only display, not switch. |
| **Bonjour discovery** | Find Ember+ server via `_ember._tcp` instead of configuring host and port manually. Convenience, not a must-have. |
| **Stable CoreMIDI endpoint identity** | The two extenders report the same port name. Currently they are mapped via `occurrence` and a fader test; after replugging the order can change. Mapping via unique CoreMIDI endpoints/USB serial numbers would replace this. |
| **Expand settings UI** | Further expand configuration and diagnostics (ports, mapping, allowlist, motor options, logs, key assignment). The network option is already integrated there as a draft. |

## Not needed / deferred

- **Rebuilding the complete MCU key set:** REC/Record-Arm, DAW transport, Jog/Scrub as transport control, Zoom, Marker/Cycle, Automation, Save/Undo, Flip, SMPTE/Beats, instrument/plugin keys, footswitch and expression should not be assigned just because the X-Touch offers them. Individual keys can later be repurposed for a clear live workflow; the extenders only have their eight channel strips anyway.
- **EQ, Dynamics, Plugins, Snapshots and input patching:** no verified Ember+ path and no need for the core task. Do not build a second Fairlight interface for this.
- **AFV, talkback routing, cue player and loudness reset:** documented in Ember+, but standalone production tasks. Do not assign them to free keys on the side.
- **Further controller modes and connections:** HUI, Xctl, DIN-MIDI, footswitch and expression offer no added value for the current MC setup.

## Known hardware limitations

- After a USB replug, macOS does not always re-enumerate the X-Touch extender; a power reset of the extender fixes it. The bridge reacts correctly as soon as the device reappears.
- The motorized end stops do not reach the last few millimeters; a small manual residual travel remains at the top and bottom.
