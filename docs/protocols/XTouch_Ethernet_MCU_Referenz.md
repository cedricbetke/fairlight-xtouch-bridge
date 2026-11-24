# Behringer X-Touch – Ethernet – MCU/MC Function Reference

**As of:** 23 November 2026  
**Scope:** Mackie Control mode (`MC`, MCU), device **Behringer X-Touch**, connection **Ethernet**. No association with Fairlight or other applications.  
**Physical features:** nine (8 channel faders + master) touch-sensitive motorized faders, 8 push-turn encoders with LED rings, 8 channel displays, 8 meters, and REC/SOLO/MUTE/SELECT per channel.

## 1. Interface and setup

- **Transport:** `MC` over **RTP-MIDI / AppleMIDI** (MIDI messages are carried over the network). The MCU MIDI payload essentially corresponds to the USB connection.
- **Setup:** Power off the device → hold **SELECT channel 1** while powering on → **Encoder 1: `MC`**, **Encoder 2: `NETWORK`** → exit with SELECT channel 1.
- **Network:** RTP **SLAVE** or RTP **MASTER** selectable on the device; DHCP or static IP address/subnet mask/gateway. The exact connection direction depends on the master/slave configuration.
- **Default port:** **5004** is named in the manufacturer's manual for RTP-MIDI as the usual session port. RTP-MIDI is **not** Ember+ and also not a general MCU TCP socket; it requires an RTP-MIDI session/implementation.
- **macOS:** network MIDI in Audio MIDI Setup. **Windows:** typically the rtpMIDI driver or compatible software. **Linux:** use a compatible RTP-MIDI service/stack; test compatibility specifically.
- **Multiple devices:** each device needs its own identity or a separate RTP-MIDI session so that MIDI channels/faders do not collide.
- **Other Ethernet modes:** with matching firmware versions, additional device-specific modes exist, e.g. `Xctl` on the large X-Touch. This file describes **MC over RTP-MIDI**, not that separate protocol.
- **Other connections of the large X-Touch:** physical 5-pin MIDI IN/OUT connectors, two footswitch inputs and one expression input. They should not be equated with USB MIDI or RTP-MIDI.

## 2. MIDI message types

| Message | MIDI status (typical) | Function |
| --- | --- | --- |
| Note On / Note Off | `0x90` / `0x80` (MIDI channel 1, zero-based 0) | Key presses, fader touch, key/status LEDs |
| Control Change | `0xB0` (MIDI channel 1) | Encoder movement, LED rings and other indicators |
| Pitch Bend | `0xE0` to `0xE7` as well as `0xE8` | 14-bit fader position per strip |
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

### Master fader

| Element | MCU address | Function |
| --- | --- | --- |
| Master fader | Pitch Bend, MIDI channel 9 (`0xE8`) | 14-bit motor/user position |
| Master fader touch | Note 112 | Touch state |

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

## 5. Global keys: complete MCU note list

The following numbers are **decimal** and refer to the classic Mackie Control notes. Key labels are merely event names: the actual software function is defined by the host.

### Channel keys (for 8 strips)

| Key / event | Note(s), decimal |
| --- | --- |
| REC 1–8 | 0–7 |
| SOLO 1–8 | 8–15 |
| MUTE 1–8 | 16–23 |
| SELECT 1–8 | 24–31 |
| Encoder push 1–8 | 32–39 |

### Encoder Assign

| Key / event | Note(s), decimal |
| --- | --- |
| Track | 40 |
| Send | 41 |
| Pan/Surround | 42 |
| Plug-in | 43 |
| EQ | 44 |
| Instrument | 45 |

### Bank / Channel

| Key / event | Note(s), decimal |
| --- | --- |
| Bank Left | 46 |
| Bank Right | 47 |
| Channel Left | 48 |
| Channel Right | 49 |
| Flip | 50 |
| Global View | 51 |

### Display / function

| Key / event | Note(s), decimal |
| --- | --- |
| Name/Value | 52 |
| SMPTE/Beats | 53 |
| F1–F8 | 54–61 |

### View keys

| Key / event | Note(s), decimal |
| --- | --- |
| MIDI Tracks | 62 |
| Inputs | 63 |
| Audio Tracks | 64 |
| Audio Instruments | 65 |
| Aux | 66 |
| Busses | 67 |
| Outputs | 68 |
| User | 69 |

### Modifier

| Key / event | Note(s), decimal |
| --- | --- |
| Shift | 70 |
| Option | 71 |
| Control | 72 |
| Alt | 73 |

### Automation

| Key / event | Note(s), decimal |
| --- | --- |
| Read/Off | 74 |
| Write | 75 |
| Trim | 76 |
| Touch | 77 |
| Latch | 78 |
| Group | 79 |

### Utility

| Key / event | Note(s), decimal |
| --- | --- |
| Save | 80 |
| Undo | 81 |
| Cancel | 82 |
| Enter | 83 |

### Marker / additional functions

| Key / event | Note(s), decimal |
| --- | --- |
| Marker | 84 |
| Nudge | 85 |
| Cycle | 86 |
| Drop | 87 |
| Replace | 88 |
| Click | 89 |
| Solo (global) | 90 |

### Transport

| Key / event | Note(s), decimal |
| --- | --- |
| Rewind | 91 |
| Forward | 92 |
| Stop | 93 |
| Play | 94 |
| Record | 95 |

### Navigation / Jog

| Key / event | Note(s), decimal |
| --- | --- |
| Up | 96 |
| Down | 97 |
| Left | 98 |
| Right | 99 |
| Zoom | 100 |
| Scrub | 101 |
| Jog turn (no note event) | CC 60 |

### Footswitches

| Key / event | Note(s), decimal |
| --- | --- |
| Footswitch 1 | 102 |
| Footswitch 2 | 103 |

### Touch / status

| Key / event | Note(s), decimal |
| --- | --- |
| Fader touch 1–8 | 104–111 |
| Master fader touch | 112 |
| SMPTE LED | 113 |
| BEATS LED | 114 |
| Rude Solo LED | 115 |

## 6. Other MCU displays and controllers

| Display / controller | Address | Meaning |
| --- | --- | --- |
| Encoder 1–8 turn | CC 16–23 | Relative values |
| LED ring 1–8 | CC 48–55 | Ring mode and position |
| Jog wheel | CC 60 | Relative turn direction/steps |
| 10-digit timecode display | CC 64–73 | Seven-segment digits |
| 2-digit assignment display | CC 74–75 | Seven-segment digits |
| SMPTE/BEATS/RUDE SOLO status lamps | Notes 113–115 | LED feedback |
| Footswitch 1/2 | Notes 102–103 | Standard MCU mapping |
| Expression pedal | Device/mode-dependent MIDI CC | Do not fix to a specific MCU CC without a MIDI monitor |

## 7. References and limitations

- [Mackie Control MIDI protocol reference (TouchMCU)](https://github.com/NicoG60/TouchMCU/blob/main/doc/mackie_control_protocol.md) – classic notes, CC, pitch bend, SysEx, metering and status LEDs.
- [Behringer X-Touch](https://behringer.com/de/products/0808-AAD) – device, firmware and downloads.
- [Behringer X-Touch Extender](https://behringer.com/en/products/0808-AAH) – Extender documentation and firmware.
- [Behringer X-Touch Extender Quick Start Guide (PDF)](https://cdn.mediavalet.com/aunsw/musictribe/osoCBB9yQUiq2pMUR6QlQg/inq2-0NOkk6L3_Xqw1r2AA/Original/QSG_BE_0808-AAH_X-TOUCH%20EXTENDER_WW.pdf) – operating modes, USB, network, RTP-MIDI.
- [X-Touch Extender MIDI Library](https://github.com/Aldaviva/BehringerXTouchExtender) – independent implementation and differences between modes.
- [X-Touch Xctl example project](https://github.com/pythag/x-touch-xctl) – **different** Ethernet protocol, not MCU/RTP-MIDI.

**Important limitation:** The classic MCU note/CC reference is a protocol reference and not a byte-for-byte document guaranteed by the manufacturer for every firmware. Where applicable, confirm X-Touch-specific colors/SysEx, special keys, pedals and different firmware versions with a MIDI monitor on the actual device. No live hardware tests were performed.
