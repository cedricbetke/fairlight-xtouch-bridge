# Fairlight Live – Ember+ API Reference

**As of:** 23 Nov 2026  
**Scope:** The Ember+ interface of Fairlight Live as published in Blackmagic Design documentation; not the entire Fairlight interface and not the separate OSC API.  
**Primary source:** [Fairlight Live User Manual](https://documents.blackmagicdesign.com/UserManuals/FairlightLiveManual.pdf), Appendix, English edition, pages 68–71.  

## Protocol and common rules

- **Protocol:** Ember+ (Glow/S101) over TCP; the server port is set in the Show Settings of Fairlight Live and is **not a fixed, predefined port**.
- **Discovery:** Bonjour / DNS-SD: `_ember._tcp`.
- **Operations:** read parameters (`Get`), write them (`Set`, where permitted) and subscribe (`Subscribe`); node subscriptions include child parameters.
- **Dynamic tree:** channels, buses and assigned sends may appear or disappear depending on the current show. A path pattern does not prove that the corresponding instance exists.
- **Indices:** start at **1**; `N` = channel/bus/monitor index, `A` = target index, `T` = talkback circuit.
- **Boolean:** `false` = off/not muted, `true` = on/muted, depending on the function of the respective parameter.
- **Meters:** read-only in principle; with a Subscribe connection they update, according to the manual, at intervals of up to 50 ms and at least once per second.
- **Access rights:** Where Blackmagic does not explicitly state `read-only`, the manual does not restrict the parameter to reading. Query actual writability and availability on the device; in particular, do not assume names, counts and system status are writable without checking.

## 1. System

| Path / Function | Type / Argument | Meaning |
| --- | --- | --- |
| `system/onair` | Boolean | Off-air/on-air state |
| `system/reset-loudness` | Function, no value | Reset and restart loudness measurements |

## 2. Input channels

Base `channel/channelN/`.

| Path | Type / Range | Meaning |
| --- | --- | --- |
| `channel/channelN/level` | Real, −100.0 to +10.0 dB | Fader level |
| `channel/channelN/mute` | Boolean | Mute |
| `channel/channelN/pan` | Real, −100.0 to +100.0 | Pan |
| `channel/channelN/name` | String | User-defined channel name |
| `channel/channelN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Peak channel level |

## 3. Buses

Available namespaces: `main/mainN`, `sub/subN`, `aux/auxN`, `mixm/mixmN`, `mtx/mtxN`.

| Path / Pattern | Type / Range | Meaning |
| --- | --- | --- |
| `<type>/<typeN>/level` | Real, −100.0 to +10.0 dB | Bus fader |
| `<type>/<typeN>/mute` | Boolean | Bus mute |
| `<type>/<typeN>/pan` | Real, −100.0 to +100.0 | Bus pan; **not** on main buses |
| `<type>/<typeN>/name` | String | Bus name |
| `sub/subN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Subgroup peak |
| `aux/auxN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Aux peak |
| `mixm/mixmN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Mix-minus peak |
| `mtx/mtxN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Matrix peak |
| `main/mainN/meters/meter` | Real, −60.0 to 0.0 dB, **read-only** | Main peak |
| `main/mainN/meters/integrated` | Real, −100.0 to +18.0, **read-only** | Integrated loudness |

## 4. Sends

**Important:** both **input channels and buses** can act as `<source>`, provided the respective show has assigned a send there. Paths for unassigned sends do not exist.

Example: `channel/channel1/sends/aux/aux2/level`.

| Path under `<source>` | Type / Range | Meaning |
| --- | --- | --- |
| `sends/aux/auxA/level` | Real, −100.0 to +10.0 dB | Aux send level |
| `sends/aux/auxA/mute` | Boolean | Aux send mute |
| `sends/aux/auxA/pan` | Real, −100.0 to +100.0 | Aux send pan |
| `sends/mixm/mixmA/level` | Real, −100.0 to +10.0 dB | Mix-minus send level |
| `sends/mixm/mixmA/mute` | Boolean | Mix-minus send mute |
| `sends/mixm/mixmA/pan` | Real, −100.0 to +100.0 | Mix-minus send pan |
| `sends/mtx/mtxA/level` | Real, −100.0 to +10.0 dB | Matrix send level |
| `sends/mtx/mtxA/mute` | Boolean | Matrix send mute |
| `sends/mtx/mtxA/pan` | Real, −100.0 to +100.0 | Matrix send pan |

## 5. Monitoring

Four monitoring circuits: `monitor/monitor1` to `monitor/monitor4`.

| Path | Type / Range | Meaning |
| --- | --- | --- |
| `monitor/monitorN/level` | Real, −100.0 to +10.0 dB | Monitor level |
| `monitor/monitorN/mute` | Boolean | Monitor mute |
| `monitor/monitorN/dim` | Boolean | Monitor dim |
| `monitor/monitor1/meters/meter` | Real, −60.0 to 0.0 dB, **read-only** | Meter monitor 1 |
| `monitor/monitor1/meters/integrated` | Real, −100.0 to +18.0, **read-only** | Loudness monitor 1 |
| `monitor/monitor1/meters/true-peak` | Real, −60.0 to 0.0 dB, **read-only** | True peak monitor 1 |
| `monitor/monitorN/meter` | Real, −60.0 to 0.0 dB, **read-only** | Meter for monitors 2–4 (this separate path) |

## 6. AFV – Audio Follows Video

| Path | Type / Range | Meaning |
| --- | --- | --- |
| `afv/on` | Boolean | Enable AFV |
| `afv/program` | Integer, 1 to camera count | Program camera |
| `afv/preview` | Integer, 1 to camera count | Preview camera |
| `afv/fade-in-time` | Integer, 0 to 2000 ms | Fade-in time |
| `afv/fade-in-level` | Real, −100.0 to 0.0 dB | Fade-in level |
| `afv/fade-out-time` | Integer, 0 to 2000 ms | Fade-out time |
| `afv/fade-out-level` | Real, −100.0 to 0.0 dB | Fade-out level |
| `afv/hold-time` | Integer, 0 to 1000 ms | Hold time |
| `afv/camera-count` | Integer, 1 to 128 | Camera count |
| `afv/cameras/cameraN/name` | String | Camera name |

## 7. Talkback

Four circuits: `talkback/circuit1` to `talkback/circuit4`; circuit 1 is the main operator.

| Path | Type | Meaning |
| --- | --- | --- |
| `talkback/circuitT/groups/talkN` | Boolean | Routing to talkback group 1–4 |
| `talkback/circuitT/monitors/monitorN` | Boolean | Routing to monitoring circuit |
| `talkback/circuitT/channels/channelN` | Boolean | Routing to input channel |
| `talkback/circuitT/buses/sub/subN` | Boolean | Routing to subgroup |
| `talkback/circuitT/buses/aux/auxN` | Boolean | Routing to aux bus |
| `talkback/circuitT/buses/mixm/mixmN` | Boolean | Routing to mix-minus bus |

## 8. Cue Player – Ember+ functions

These entries are function calls, not regular continuous parameters.

| Function | Argument | Meaning |
| --- | --- | --- |
| `cueplayer/dump` | none | Retrieve all cues |
| `cueplayer/play/a` | Integer 1–8 | Start audio cue bank A |
| `cueplayer/play/b` | Integer 1–8 | Start audio cue bank B |
| `cueplayer/play/midi-A` | Integer 1–8 | Trigger MIDI cue bank A |
| `cueplayer/play/midi-B` | Integer 1–8 | Trigger MIDI cue bank B |

## 9. Not documented in this Ember+ API

Missing documentation does not prove that something is impossible through **other** interfaces. However, the described Ember+ tree lists no paths for Solo/PFL/AFL, EQ, compressor/gate/dynamics, VST plug-ins, VCA/DCA, snapshots, input patching or recorder transport. This is not a list of all Fairlight Live functions.

## Sources

1. Blackmagic Design, [Fairlight Live User Manual, Ember+ Protocol in Fairlight Live, pp. 68–71](https://documents.blackmagicdesign.com/UserManuals/FairlightLiveManual.pdf) (authoritative source).
2. Blackmagic Design, [Fairlight Live](https://www.blackmagicdesign.com/products/fairlightlive) (product context, not an API reference).

**Validation status:** Documentation reference; no active connection to a running Fairlight show was made.
