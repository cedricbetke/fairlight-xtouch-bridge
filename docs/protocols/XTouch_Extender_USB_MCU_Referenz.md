# Behringer X-Touch Extender – USB – MCU/MC Function Reference

**As of:** 23 November 2026  
**Scope:** Mackie Control mode (`MC`, MCU), device **Behringer X-Touch Extender**, connection **USB**. No association with Fairlight or other applications.  
**Physical features:** eight touch-sensitive motorized faders, 8 push-turn encoders with LED rings, 8 channel displays, 8 meters, and REC/SOLO/MUTE/SELECT per channel.

## 1. Interface and setup

- **Transport:** Class-compliant USB MIDI over the USB-B computer port (bidirectional).
- **Setup:** Power off the device → hold **SELECT channel 1** while powering on → **Encoder 1: `MC`**, **Encoder 2: `USB`** → exit with SELECT channel 1.
- **Computer:** The operating system provides a MIDI input and MIDI output for the device; programs read and send the usual MCU MIDI messages.
- **No network/no port:** USB MIDI has no IP address and no TCP/UDP port. USB hub Type-A sockets are not an additional MCU port.
- **Important:** use a separate MIDI input/output per device when multiple controllers are connected.
- **Extender specifics:** no global DAW keys, no jog wheel, no master fader. Only eight channel strips are present; the MCU standard notes for global controls below do **not** exist as physical keys on the Extender.

## 2. MIDI message types

| Message | MIDI status (typical) | Function |
| --- | --- | --- |
| Note On / Note Off | `0x90` / `0x80` (MIDI channel 1, zero-based 0) | Key presses, fader touch, key/status LEDs |
| Control Change | `0xB0` (MIDI channel 1) | Encoder movement, LED rings and other indicators |
| Pitch Bend | `0xE0` to `0xE7` | 14-bit fader position per strip |
| Channel Pressure | `0xD0` | Channel metering / LED level |
| System Exclusive | `0xF0 … 0xF7` | LCD text, device-specific extensions and identification |

**Terminology:** MIDI channel 1 is often referred to as “channel 0” in protocol documentation. The printed faders are labeled 1–8. The `MC` mode is not identical to `HUI`, `Ctrl` or `CtrlRel`.

## 3. Channel strips – complete MC control and display elements

| Control / output | MCU address | Direction and function |
| --- | --- | --- |
| Motor faders 1–8 | Pitch Bend, MIDI channels 1–8 | Send + receive, position 0–16383 (14 bit) |
| Touch 1–8 | Notes 104–111 | Report touch state |
| REC 1–8 | Notes 0–7 | Key input + LED output |
| SOLO 1–8 | Notes 8–15 | Key input + LED output |
| MUTE 1–8 | Notes 16–23 | Key input + LED output |
| SELECT 1–8 | Notes 24–31 | Key input + LED output |
| Encoder push 1–8 | Notes 32–39 | Key input |
| Encoder turn 1–8 | CC 16–23 | Relative turn value, e.g. 1 for +1 and 65 for −1; further steps device-dependent |
| Encoder LED ring 1–8 | CC 48–55 | Host sets ring position/mode |
| Scribble strip 1–8 | MCU SysEx LCD | Text and display updates; usually two lines each |
| Scribble strip color | X-Touch-specific SysEx | Firmware-dependent color control; not a universal MCU standard |
| VU/channel meter 1–8 | Channel Pressure | Host sends meter values/peak information |

**No master fader:** Note 112 and pitch-bend channel 9 are core MCU functions, but on the X-Touch **Extender** there is no corresponding control.

## 4. Detailed communication and feedback functions

| Output / event | Direction | Note |
| --- | --- | --- |
| Fader movement | Device ↔ Host | Pitch Bend: 14 bit, value `0..16383`; dB curve not defined in the MCU protocol |
| Fader touched / released | Device → Host | Touch note on/off; motor feedback can be withheld accordingly |
| Channel keys | Device → Host | Note On/Note Off or equivalent status; account for press/release |
| LEDs | Host → Device | Note-based LED off/on/blink control; common values 0/127 or 1 for blinking |
| Encoder direction | Device → Host | Relative CC values, no direct decibel/pan semantic field |
| Encoder ring | Host → Device | CC 48–55, combination of display mode and position |
| LCD text | Host → Device | MCU SysEx; ASCII-like text data, write position/offset |
| LCD colors | Host → Device | Device-specific SysEx; availability/color codes depend on firmware |
| Meter/clip | Host → Device | Channel Pressure encodes strip and meter position/clip status |
| Device identification / version | both | MCU SysEx commands; note implementation/firmware dependence |

### MCU message examples (structural)

```text
MIDI Note On (key):        90 <note> 7F
MIDI Note Off/Release:     90 <note> 00   (or 80 <note> 00)
Pitch Bend Fader 1:        E0 <LSB> <MSB>
Pitch Bend Fader 8:        E7 <LSB> <MSB>
Encoder 1 turn:            B0 10 <relative value>
LED ring Encoder 1:        B0 30 <mode+position>
Meter via Channel Pressure D0 <strip+level>
MCU LCD/SysEx:             F0 00 00 66 <device-id> 12 <offset> <text...> F7
```

`<...>` denotes placeholders and **not directly executable packets**. For MCU device IDs, `0x14` (Main) and `0x15` (XT/Extender) are documented, among others; when in doubt, check the actual SysEx identification and firmware.

## 5. Extender-specific assignment

The X-Touch Extender has **only** the physical MCU controls listed below. Global MCU notes 40–103 are therefore not additional Extender keys. The assignment is separate per Extender port or network session.

| Area | Note (decimal) | Remark |
| --- | --- | --- |
| REC 1–8 | 0–7 | 8 illuminated channel keys |
| SOLO 1–8 | 8–15 | 8 illuminated channel keys |
| MUTE 1–8 | 16–23 | 8 illuminated channel keys |
| SELECT 1–8 | 24–31 | 8 illuminated channel keys |
| Encoder push 1–8 | 32–39 | 8 pressable encoders |
| Fader touch 1–8 | 104–111 | 8 touch-sensitive faders |

## 6. Encoder, fader, display and meter – address table

| Strip | Fader pitch-bend status | Fader touch note | Encoder CC | Encoder-ring CC | REC / SOLO / MUTE / SELECT note |
| --- | --- | --- | --- | --- | --- |
| 1 | `0xE0` | 104 | 16 | 48 | 0 / 8 / 16 / 24 |
| 2 | `0xE1` | 105 | 17 | 49 | 1 / 9 / 17 / 25 |
| 3 | `0xE2` | 106 | 18 | 50 | 2 / 10 / 18 / 26 |
| 4 | `0xE3` | 107 | 19 | 51 | 3 / 11 / 19 / 27 |
| 5 | `0xE4` | 108 | 20 | 52 | 4 / 12 / 20 / 28 |
| 6 | `0xE5` | 109 | 21 | 53 | 5 / 13 / 21 / 29 |
| 7 | `0xE6` | 110 | 22 | 54 | 6 / 14 / 22 / 30 |
| 8 | `0xE7` | 111 | 23 | 55 | 7 / 15 / 23 / 31 |

**Note:** The Extender has no transport/automation/navigation keys, no global timecode LED display, and no physical footswitch/expression inputs like the large X-Touch. An application can of course implement virtual global commands itself; however, these are **not hardware events** of the Extender.

## 7. References and limitations

- [Mackie Control MIDI protocol reference (TouchMCU)](https://github.com/NicoG60/TouchMCU/blob/main/doc/mackie_control_protocol.md) – classic notes, CC, pitch bend, SysEx, metering and status LEDs.
- [Behringer X-Touch](https://behringer.com/de/products/0808-AAD) – device, firmware and downloads.
- [Behringer X-Touch Extender](https://behringer.com/en/products/0808-AAH) – Extender documentation and firmware.
- [Behringer X-Touch Extender Quick Start Guide (PDF)](https://cdn.mediavalet.com/aunsw/musictribe/osoCBB9yQUiq2pMUR6QlQg/inq2-0NOkk6L3_Xqw1r2AA/Original/QSG_BE_0808-AAH_X-TOUCH%20EXTENDER_WW.pdf) – operating modes, USB, network, RTP-MIDI.
- [X-Touch Extender MIDI Library](https://github.com/Aldaviva/BehringerXTouchExtender) – independent implementation and differences between modes.
- [X-Touch Xctl example project](https://github.com/pythag/x-touch-xctl) – **different** Ethernet protocol, not MCU/RTP-MIDI.

**Important limitation:** The classic MCU note/CC reference is a protocol reference and not a byte-for-byte document guaranteed by the manufacturer for every firmware. Where applicable, confirm X-Touch-specific colors/SysEx, special keys, pedals and different firmware versions with a MIDI monitor on the actual device. No live hardware tests were performed.
