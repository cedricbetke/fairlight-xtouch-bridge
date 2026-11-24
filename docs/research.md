# Research and Protocol Foundations

As of 22 Nov 2026. Source findings, mock tests and measurements on the studio Mac (Fairlight Live 1.1.1, macOS 26.6.1, X-Touch with two extenders). Where a statement comes only from sources and was not measured on the device, it is labeled accordingly.

## Detailed references

- [Fairlight Live: Ember+](protocols/Fairlight_Live_EmberPlus_API.md)
- X-Touch (MCU): [USB](protocols/XTouch_USB_MCU_Referenz.md) · [Ethernet](protocols/XTouch_Ethernet_MCU_Referenz.md)
- X-Touch Extender (MCU): [USB](protocols/XTouch_Extender_USB_MCU_Referenz.md) · [Ethernet](protocols/XTouch_Extender_Ethernet_MCU_Referenz.md)

## 1. Fairlight Live 1.1.1: Ember+

### Officially documented

The Fairlight Live 1.1.1 release notes mention no change to Ember+. The protocol reference is the Fairlight Live appendix in the manual (pages 67–70). According to it:

- Ember+ (Glow/S101) is enabled in **File → Show Settings → Ember+**. Server port and server name are configurable; the service is announced via Bonjour `_ember._tcp`.
- Clients can read, write and subscribe to parameters. A subscription to a node includes the parameters below it. The tree mirrors the current mixer configuration and changes with the show.
- Indices are one-based. Boolean: `false` = off/unmuted, `true` = on/muted. Meters are read-only.
- Input channels: `channel/channelN/{level,mute,pan,name,meter}`. `level` Real −100…+10 dB, `mute` Boolean, `pan` Real −100…+100, `name` String, `meter` Real −60…0 dB read-only.
- Buses: `main/mainN`, `sub/subN`, `aux/auxN`, `mixm/mixmN`, `mtx/mtxN` with `level`, `mute`, `name`; `pan` not on main buses. Not every bus type exists in every show.
- **VCA/DCA** exists in Fairlight Live as a bus group, but is not listed in the Ember+ appendix. The bridge therefore additionally looks for a root `vca` or `dca` and treats it like a bus. Whether, and under which path, Fairlight actually publishes VCA parameters is open and requires a dump of a show with VCAs.
- Meters: Sub/Aux/MixMinus/Matrix under `<bus>/meter`; Main under `main/mainN/meters/meter`, plus `integrated`. Subscribed meters update up to every 50 ms, at least once per second.
- Sends are located under `<source>/sends/{aux,mixm,mtx}/...`.
- Monitor nodes are used by this bridge for Monitor-Dim on an assigned function key (updated 24 Nov 2026). AFV, talkback and cue player nodes are documented but are not used.

**Not documented** are Select, Solo, PFL, AFL, plugin control or a stable channel ID. The product page names MCU/OSC support for Selection and PFL/AFL; that is not evidence of an Ember+ path. These functions remain disabled.

### Deviations and open points

- The manual lists the main meter under `meters/meter`; a published show dump from a third party observed `main/mainN/meter`. The bridge reads meters and accepts both paths (direct `meter` and nested `meters/meter`), so the deviation is handled; which path Fairlight Live 1.1.1 actually publishes for main buses was not verified separately on the device.
- Whether Fairlight 1.1.1 reliably sends parameter changes as a push is not fully documented. In testing, level, mute and name changes were pushed; the client subscribes to parameters and strip nodes and re-reads on structural changes. A polling fallback for individual faders is not implemented.
- The tree reports new or deleted channels via root updates. During re-discovery the bridge briefly locks and then automatically adopts the new structure (positional mapping). There is no stable identity across reordering.
- `system/onair` is documented as a Boolean. The bridge reads and subscribes to it for a read-only on-air badge and never writes it. The mock provider covers the path, including a missing parameter; whether Fairlight Live 1.1.1 pushes changes and whether every show exposes it still has to be checked on the studio Mac.
- CoreMIDI exposes no stable endpoint identifier through the MIDI backend in use. Two extenders with the same port name are therefore bound by occurrence and index only. If the port list for a shared name changes, the bridge locks all affected roles until restart instead of guessing which physical unit moved.

### Measurements on the studio Mac (22 Nov 2026)

- Fairlight Live 1.1.1, Ember+ on `127.0.0.1:9000`. Test show with 36 to 57 channels and 5 buses; the channel structure was detected dynamically.
- `level`, `mute`, `name` and `meter` were readable; `level` and `mute` writable, `meter` read-only. `pan` was present as **READ_WRITE** and is now written via the encoders.
- The provider rounds `level` values to 0.1 dB (e.g. −29.15095 → −29.1). The bridge rounds to 0.1 dB before sending and accepts confirmations within 0.05 dB.
- Faders in both directions, mute with LED, master, 24 channels, banking, start/bank alignment, LCD names, MIDI hotplug and Fairlight reconnect worked with main and two extenders.
- Structural changes (adding, removing, renaming channels) arrived as root updates. The bridge briefly locked and adopted the new structure without restart.
- macOS port names: main `X-Touch INT`, extender `X-Touch-Ext X-TOUCH_INT` (twice, separated by occurrence). LCD device byte: main `0x14`, both extenders `0x15`.
- The fader curve was measured against the printed markings; for anchors see `docs/hardware-test.md`. The motorized end stops do not reach the last millimeters.
- A USB cascade through an extender's hub produced duplicate or silent MIDI ports. Use separate USB paths. After a plain USB replug, macOS did not always re-detect the extender; a power reset of the extender helped.

Sources:

- Blackmagic Design, Fairlight Live 1.1.1 Release Notes: <https://www.blackmagicdesign.com/support/content/readme/d1773199536843e6bb5ae1bea79b4094>
- Fairlight Live Manual, Show Settings p. 11 and Ember+ appendix pp. 67–70: <https://documents.blackmagicdesign.com/UserManuals/FairlightLiveManual.pdf>
- Blackmagic Fairlight Live product page (third-party control): <https://www.blackmagicdesign.com/products/fairlightlive>
- Fairlight Live Web Controller, Ember+ observations and show dump: <https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/blob/main/docs/fairlight-ember.md>
- Kortesaas Fairlight Remote Controller (reference, **without license file**): <https://github.com/Kortesaas/fairlight-remote-controller>

The Kortesaas code was not adopted. According to GitHub metadata, the repository has no license; reuse without permission is not allowed. It does, however, confirm the dynamic detection of the documented root nodes and the use of level/mute/meter.

## 2. MCU and X-Touch

The bridge treats each device as its own MCU device with eight local strips. The extenders do not continue on MIDI channel 9. On each port, the following apply locally:

| Function | Message |
|---|---|
| Fader 1–8 | Pitch Bend `E0`…`E7`, 14 bit (`LSB`, `MSB`) |
| Master fader (X-Touch only) | Pitch Bend `E8` |
| Fader touch 1–8 | Note `0x68`…`0x6F`, Velocity `0x7F` = down, `0x00` = up |
| Master touch | Note `0x70` |
| Mute 1–8 | Note `0x10`…`0x17` |
| Select 1–8 | Note `0x18`…`0x1F` |
| Solo 1–8 | Note `0x08`…`0x0F` |
| Record 1–8 | Note `0x00`…`0x07` |
| Encoder rotation | CC `0x10`…`0x17`, relative, with sign bit `0x40` |
| Encoder press | Note `0x20`…`0x27` |
| Bank left/right | Note `0x2E`/`0x2F` |
| Channel left/right | Note `0x30`/`0x31` |
| V-Pot ring | CC `0x30`…`0x37` |
| Channel meter | Channel Pressure `D0`, upper nibble strip, lower nibble segment |
| LCD text | SysEx `F0 00 00 66 <device> 12 <offset> <ASCII> F7`; X-Touch `0x14`, both extenders `0x15` (verified on device) |
| LCD color | SysEx `F0 00 00 66 <device> 72 <8 colors> F7`; color codes 0=off, 1=red, 2=green, 3=yellow, 4=blue, 5=magenta, 6=cyan, 7=white |

Sources for the byte mapping:

- UI24RBridge, MIT: <https://github.com/MatthewInch/UI24RBridge/blob/930713a98af233a0082cdd3b2330191483e25f04/UI24RController/MIDIController/MC.cs>
- Cubase MCU MIDI Remote, MIT: <https://github.com/bjoluc/cubase-mcu-midiremote>
- Behringer X-Touch Quick Start and Extender product page (device functions, MC mode)
- FLtouch (only as protocol corroboration; license CC BY-NC-SA, **no code adopted**)

The bridge currently uses faders, touch, mute, bank, master, the LCD display with channel names, line modes, type colors and manual exceptions, the pan control via the encoders including the V-Pot ring, and the level indicators from the Ember+ meter parameter. Select, Solo, Record and Jog are decoded but not sent to Fairlight. Encoder deltas move pan in steps of five units; encoder push resets to center. Pan subscriptions run for every discovered bus and channel. Channel and bus meter parameters are subscribed when LED meters are enabled on any device, or when the main display uses the `meter` mode, because the display reads the same parameters.

### Main-unit seven-segment display (24 Nov 2026)

The large X-Touch has a ten-digit timecode display and two assignment digits ([Behringer](https://www.behringer.com/en/products/0808-AAD)). In MC mode each digit is addressed with its own Control Change, counted from the right: CC 64–73 for timecode and CC 74–75 for assignment. The value carries the character code; `0x40` added to it lights that digit's decimal point.

Sources agree on digits `0x30`–`0x39`, `A`–`Z` as `0x01`–`0x1A` and `-` as `0x2D`. Cubase's X-Touch MIDI Remote script writes digits and dots this way ([`SegmentDisplayManager.ts`](https://github.com/bjoluc/cubase-mcu-midiremote/blob/main/src/midi/managers/SegmentDisplayManager.ts)). ReaLearn encodes the same range and uses a space with dot (`0x20 + 0x40`) for a lone period ([`midi_source.rs`](https://github.com/helgoboss/helgoboss-learn/blob/master/src/source/midi_source.rs#L2013-L2054)); Ardour's Mackie surface uses the same translation ([`surface.cc`](https://github.com/Ardour/ardour/blob/master/libs/surfaces/mackie/surface.cc#L1305-L1317)). An Ableton X-Touch script shows the local clock and short messages on the display, including the 3‑2‑2‑3 layout used for time code ([`TimeDisplay.py`](https://github.com/Kik07L/Behringer-X-Touch-for-ableton/blob/main/XTouch/TimeDisplay.py#L174-L221)).

The bridge uses this display for the visible channel range, the active aux, the host clock, a Fairlight measurement and, as an experimental option, the on-air state.

The measurement mode reads documented Ember+ values: integrated loudness from `main/mainN/meters/integrated` and the peak level from `<type>/<typeN>/meter` (for the headroom reserve). The diagnostics-only tree in the documentation lists them as read-only real values; the bridge subscribes to the bus meter parameters whenever the meter mode or an LED meter chain is active, and never calls `system/reset-loudness`. Discovery, subscription and display formatting are covered by tests against the mock Ember+ provider and the virtual MIDI backend. **Not verified:** the live value range and refresh rate of a real Fairlight instance, and whether Fairlight exposes `meters` on every main bus in a given show. The byte mapping and deduplication are covered by automated tests against a virtual MIDI backend. **Visual verification on the real X-Touch is still open:** whether `-` and words such as `ON AIR` are clearly readable, and whether the display needs a rewrite after a real USB replug, has not been checked on the device. The bridge therefore avoids the hyphen in normal output and marks the on-air mode as experimental.

Sources:

- [Behringer X-Touch product data](https://www.behringer.com/en/products/0808-AAD)
- [TouchMCU MCU protocol reference](https://github.com/NicoG60/TouchMCU/blob/main/doc/mackie_control_protocol.md)
- [Cubase X-Touch MIDI Remote script](https://github.com/bjoluc/cubase-mcu-midiremote)
- [ReaLearn Mackie seven-segment encoder](https://github.com/helgoboss/helgoboss-learn)
- [Ardour Mackie surface implementation](https://github.com/Ardour/ardour/blob/master/libs/surfaces/mackie/surface.cc)
- [Ableton X-Touch script with clock and messages](https://github.com/Kik07L/Behringer-X-Touch-for-ableton)

### Fader curve

No official, verified mapping between MCU 14-bit values and Fairlight dB was found. Originally the bridge used a linear mapping from 0…16383 to −100…+10 dB. On 22 Nov 2026 the curve was measured on an X-Touch against the printed markings and stored as a piecewise linear interpolation (`PiecewiseDbFaderLaw`, `XTOUCH_DB_POINTS`). The anchors are in `docs/hardware-test.md`. Other devices or firmware versions may differ and must be re-measured.

## 3. MIDI on macOS

`@julusian/midi` 3.9.0 (MIT, RtMidi-based) is used for raw MIDI. It provides port names and indices, but no CoreMIDI endpoint UIDs and no hotplug notifications. The bridge therefore polls periodically and accepts an exact name plus occurrence. Two extenders with the same name must be distinguished by occurrence.

A stable, device-specific assignment would be possible with a small Swift/CoreMIDI adapter (`kMIDIPropertyUniqueID`, notifications). This adapter is **not implemented**. If extenders are swapped, the configuration must be corrected manually.

Sources:

- `@julusian/midi`: <https://www.npmjs.com/package/@julusian/midi>
- Apple CoreMIDI Unique ID: <https://developer.apple.com/documentation/coremidi/kmidipropertyuniqueid>
- Apple CoreMIDI Notifications: <https://developer.apple.com/documentation/coremidi/midinotificationmessageid>

### AppleMIDI and RTP-MIDI (24 Nov 2026)

The bridge implements the session and payload parts it needs internally, without a third-party MIDI-over-IP library:

- Session control follows Apple's MIDI Network Driver protocol: AppleMIDI invitations (`IN`/`OK`/`NO`/`BY`) with initiator token and SSRC, sent to the peer's control port and repeated on the data port above it. The bridge always acts as the initiator, so the X-Touch has to be configured as RTP **SLAVE**.
- Clock sync uses `CK` packets on the data port. The bridge sends a sync exchange at the start and every 10 seconds. Receiver feedback (`RS`) and bitrate limits (`RL`) are parsed but not used.
- MIDI runs as RTP-MIDI with payload type 97, a 10 kHz clock and one MIDI command per packet. SysEx, including the X-Touch LCD messages, is encoded with the short or long MIDI-list header as needed.
- The bridge does not send a recovery journal and ignores incoming journals. Apple's driver requires no journal in received packets, but this point has to be checked on the real device.
- Verified against a local AppleMIDI responder in both directions: invitation on both ports, clock sync, faders, notes, running status, segmented SysEx, reconnect after a peer restart and rejection of a second session. Hardware validation with X-Touch and Extender is still open.

## 4. Ember+ library

In use: `@phillipivan/emberplus-connection@0.5.0` (MIT, fork of the Sofie implementation). Reasons:

- typed TypeScript API, ESM, requires Node.js ≥ 26;
- dynamic tree reading, GetDirectory, Subscribe/Unsubscribe, SetValue;
- built-in S101 client;
- mock server in the same library for integration tests;
- The S101 client in 0.5.0 cleans up connection and retry timers on disconnect and cleanly queues multiple calls waiting on `connect()`. This fixes the hang and the timer leaks that could occur in 0.4.5 with an unreachable port.

The bridge still manages reconnects itself: when a lost connection is detected, the Ember+ client is discarded and rebuilt with a new session. This reliably removes old subscription callbacks. Within a session, subscriptions are registered only once per path; the callbacks read the current state each time, so a structure refresh does not choke off feedback.

Alternatives:

- Sofie `emberplus-connection@0.3.1`: direct Fairlight experience in the Web Controller project, older API and older dependencies.
- Dufour `node-emberplus@3.0.8`: MIT, but subscribe support for ordinary parameters is not sufficiently documented for this purpose.
- `@phillipivan/emberplus-connection@0.4.5`: earlier, Node-22-compatible version; no longer used.

## 5. Reuse and licenses

| Project | License | Use |
|---|---|---|
| UI24RBridge | MIT | Protocol reference; no code adopted |
| Cubase MCU MIDI Remote | MIT | Protocol reference; no code adopted |
| Kortesaas Fairlight Remote Controller | no license | reference only, no code adopted |
| Fairlight Live Web Controller | MIT | Ember+ empirical observations; no code adopted |
| FLtouch | CC BY-NC-SA 4.0 | protocol corroboration only, no code |
| Ardour | GPL-2.0-or-later | protocol corroboration only, no code |
| `@phillipivan/emberplus-connection` | MIT | runtime dependency |
| `@julusian/midi` | MIT (RtMidi) | runtime dependency |

All license notices are summarized in `THIRD_PARTY_NOTICES.md`.

## 6. Functions deliberately not claimed

- No select, solo, PFL/AFL or plugin feedback via Ember+.
- Metering and pan encoders are active in the runtime path; visual inspection of ring mode and meter segments on a real X-Touch is still pending.
- No color taken over from Fairlight; Ember+ provides no color parameter. The LCD colors are derived from the channel type and manual exceptions.
- VCA/DCA is built in as a best-effort bus type, but not confirmed by a real Ember+ dump.
- LCD colors and line modes are implemented and automatically tested, but not yet verified on a real X-Touch.
- No stable channel IDs across show reordering.
- No success reports for Fairlight or hardware tests that were not performed.
