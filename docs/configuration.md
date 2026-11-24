# Configuration

The bridge reads a JSON file passed with `--config`. The settings page writes the same format, so you can use either the browser or a text editor.

## Files

| File | Purpose |
|---|---|
| `config/bridge.example.json` | Full example: main unit with fixed channels 1–8, two banking extenders, 24 write-enabled channels |
| `config/bridge.poc.example.json` | Single-channel proof of concept for the first hardware test |
| `config/bridge.demo.json` | Demo layout used by `npm run settings:demo` (no hardware needed) |
| `config/bridge.json`, `config/bridge.poc.json` | Your local copies. They are listed in `.gitignore` and should not be committed |

Validate a file without starting the bridge:

```bash
npm run dev -- config validate --config config/bridge.json
```

## Top-level structure

```json
{
  "fairlight": { ... },
  "midi": { ... },
  "mapping": { ... },
  "lcd": { ... },
  "safety": { ... },
  "logLevel": "info"
}
```

## `fairlight`

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Address of the Ember+ server (Fairlight Live on the same Mac) |
| `port` | `9000` | Ember+ server port shown in Fairlight's Ember+ settings |
| `requestTimeoutMs` | `2000` | Timeout for a single Ember+ request |
| `reconnectAttempts` | `-1` | Maximum number of reconnect attempts; `-1` (or any value of 0 or below) retries without limit |

## `midi`

`midi.devices` lists the X-Touch units. Each device has the following fields:

| Field | Values | Meaning |
|---|---|---|
| `role` | lowercase identifier, for example `main`, `extender1`, `extender2` | Internal name used by the CLI, for example `midi monitor --device main` |
| `kind` | `main` or `extender` | Hardware type. Defaults to `main` for role `main`, otherwise `extender` |
| `name` | string or `null` | Display name in the settings page |
| `enabled` | `true` / `false` | Disabled devices are ignored |
| `transport` | `usb` or `network` | Only `usb` is opened. `network` (with `host` and `port`, default RTP-MIDI port 5004) is stored as a draft; the bridge does not open network devices yet |
| `input` / `output` | `{ "name": "...", "occurrence": 0 }` | Exact CoreMIDI port name and index among ports with that name |
| `encoder` | `off` or `pan` | What the eight encoders control |
| `meters` | `true` / `false` | Show signal meters on the LED strips |

Example for one main unit and one extender:

```json
"midi": {
  "devices": [
    {
      "role": "main",
      "kind": "main",
      "enabled": true,
      "transport": "usb",
      "input":  { "name": "X-Touch INT", "occurrence": 0 },
      "output": { "name": "X-Touch INT", "occurrence": 0 },
      "encoder": "pan",
      "meters": true
    },
    {
      "role": "extender1",
      "kind": "extender",
      "enabled": true,
      "transport": "usb",
      "input":  { "name": "X-Touch-Ext X-TOUCH_INT", "occurrence": 0 },
      "output": { "name": "X-Touch-Ext X-TOUCH_INT", "occurrence": 0 },
      "encoder": "pan",
      "meters": true
    }
  ]
}
```

Port names must match `midi list` exactly. For two devices with the same name, use `occurrence: 0` and `occurrence: 1`.

The settings page also lists devices in left-to-right order, which is stored in `mapping.layout.order`.

## `mapping`

### Layout and banking

`mapping.layout` controls which strips show which target.

- `order`: left-to-right order of the devices, for example `["main", "extender1", "extender2"]`.
- `surfaces.<role>.mode`:
  - `fixed`: every fader is assigned to a target through `fixedTargets`. Eight entries, one per fader. Use `null` to leave a fader free.
  - `banking`: the device shares the remaining inputs with the other banking devices.

Fixed targets:

```json
{ "kind": "channel", "channel": 1 }
{ "kind": "bus", "busType": "aux", "index": 1 }
null
```

Banking width is **eight times the number of active banking devices**. Fixed targets are skipped in the banking sequence, and buses do not take part in banking. With one main unit and two banking extenders, that is 16 channels per bank.

The number of surfaces is not limited to three. Every enabled device with `kind: "extender"` takes part in the layout and, in banking mode, widens the banking pool by eight strips. Only one device may have `kind: "main"`. Total strips are therefore eight per device: for example 8 with the main unit alone, 16 with one extender, 24 with two, 32 with three.

The older `mapping.bankStep` value (default `24`) is used only when no `layout` is defined. Layout-based setups use the computed width described above.

A fixed-target setup with the main unit on channels 1–8 and two banking extenders looks like this:

```json
"layout": {
  "order": ["main", "extender1", "extender2"],
  "surfaces": {
    "main": {
      "mode": "fixed",
      "fixedTargets": [
        { "kind": "channel", "channel": 1 },
        { "kind": "channel", "channel": 2 },
        { "kind": "channel", "channel": 3 },
        { "kind": "channel", "channel": 4 },
        { "kind": "channel", "channel": 5 },
        { "kind": "channel", "channel": 6 },
        { "kind": "channel", "channel": 7 },
        { "kind": "channel", "channel": 8 }
      ]
    },
    "extender1": { "mode": "banking" },
    "extender2": { "mode": "banking" }
  }
}
```

Older configurations with `fixedChannels` arrays of channel numbers still load.

### Master fader

```json
"master": { "enabled": true, "busType": "main", "busIndex": 1 }
```

`busType` is one of `main`, `sub`, `aux`, `mixm`, `mtx` or `vca`. The bridge never guesses a bus: check the bus with `discover` first.

### Sends on Fader

```json
"sendsOnFader": { "enabled": true, "busIndex": 2 }
```

With this enabled, the `SEND` button on the main unit puts the faders on the send level of aux 2 for the banked channels. `PAN` returns the faders to the main mix. The bridge does not create sends.

Details: [Sends on Fader in the README](../README.md#features). Channels without that send show `NO SEND` on the LCD and stay inactive.

### Assignable keys

```json
"buttonAssignments": {
  "f1": { "type": "sends-on-fader", "auxIndex": 1 },
  "f2": { "type": "sends-on-fader", "auxIndex": 2 },
  "f3": { "type": "monitor-dim", "monitorIndex": 1 },
  "play": { "type": "sends-on-fader", "auxIndex": 2 },
  "marker": { "type": "monitor-dim", "monitorIndex": 1 }
}
```

- `sends-on-fader` selects an aux by number.
- `monitor-dim` toggles `dim` on a monitor path. The LED shows the dim state confirmed by Fairlight. Writing requires `safety.allowedWriteMonitors`.
- Assignments are stored as numbers, not names. A target that is not present in the show keeps its assignment but does nothing.
- The bridge subscribes only to the aux and monitor targets that are actually assigned.

Assignable are F1–F8 and the right-hand keys of the main unit: the encoder assign keys (TRACK, EQ, PLUG-IN, INST), the view keys, NAME/VALUE, SMPTE/BEATS, the automation keys (READ/OFF, WRITE, TRIM, TOUCH, LATCH, GROUP), SAVE/UNDO/CANCEL/ENTER, MARKER to SOLO, the transport keys and the navigation cross including SCRUB. Names in the configuration are the lower-case identifiers, for example `play`, `marker`, `global-view`.

`BANK`, `CH`, `SEND`, `PAN/SURR` and `FLIP` stay reserved so banking and the way back to the main mix always work. The modifiers SHIFT, OPTION, CONTROL and ALT cannot be assigned. Only the main unit has assignable keys.

Fairlight shortcuts and mute groups cannot be assigned yet.

### Single-channel test mode

```json
"singleChannel": 1,
"singleChannelName": "Moderation"
```

Used only for the first hardware test. `singleChannelName` must match the channel name in the show exactly and must be unique. Saving in the settings page switches the configuration to the device layout.

## `lcd`

| Key | Meaning |
|---|---|
| `colorsEnabled` | Use background colors on the LCDs |
| `line1`, `line2` | What the upper and lower LCD line shows (see below) |
| `palette` | Background color per target type |
| `overrides` | Per-target exceptions |

Line modes:

| Value | Shows |
|---|---|
| `name` | Full name from Fairlight |
| `custom` | Override short name if set, otherwise the Fairlight name |
| `type-number` | Type and number, for example `CH 12` or `AUX 2` |
| `type` | Type only |
| `number` | Number only |
| `value` | Confirmed fader value in dB, or `--` if unknown |
| `target` | Active fader target, for example in *Sends on Fader* mode |
| `blank` | Empty line |

Colors: `off`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`.

Palette keys: `channel`, `main`, `sub`, `aux`, `mixm`, `mtx`, `vca`.

Override example:

```json
"overrides": [
  {
    "target": { "kind": "channel", "channel": 1 },
    "color": "green",
    "name": "MOD",
    "expectedName": "Moderation"
  }
]
```

- `name` is a short name of up to seven characters.
- `expectedName` is the Fairlight name the override expects. If the name in the show changes, the override pauses. Press **Update** in the settings page to bind it again.
- `color` can be a color name or `"auto"`.

## `safety`

| Key | Default | Meaning |
|---|---|---|
| `requireTouchForWrites` | `true` | Ignore fader movement that is not touched |
| `alignMotorsOnStart` | `true` | Move motors once to the confirmed values after discovery |
| `alignMotorsOnBankChange` | `true` | Move motors to the new bank's values after a bank change |
| `allowedWriteChannels` | `[]` | Channel numbers that may be written |
| `allowedWriteBuses` | `[]` | Buses that may be written, as `"type:index"`, for example `"main:1"` |
| `allowedWriteMonitors` | `[]` | Monitor numbers that may be written (dim) |
| `maxWritesPerSecond` | `20` | Global write rate limit |
| `writeExpiryMs` | `250` | Age after which a pending fader value is discarded |
| `feedbackEpsilonDb` | `0.05` | Tolerance when comparing a Fairlight confirmation with the sent value |

Writes are only sent when all of the following are true:

1. The bridge is started with `--arm-writes`.
2. The target is in the matching allowlist.
3. For faders, the strip was touched (if `requireTouchForWrites` is on).

Motors also need `--arm-motor`.

Keep the allowlist in line with banking: every channel reachable through a bank must be listed, otherwise those strips stay locked even when they are assigned correctly.

## Settings page

The settings page is a local tool. It runs on your Mac and is available only at `http://127.0.0.1:8787`.

```bash
npm run settings:demo                             # three virtual units, 40 demo channels
npm run settings -- --config config/bridge.json   # real MIDI ports
npm run settings -- --port 8790 --no-discover     # other port, no discovery on start
```

What you can do there:

- **Devices:** sort by dragging the handle or with the arrows. Add or remove units. Rename them. Choose USB or network.
- **Find:** blinks the eight SELECT LEDs on the chosen MIDI output, before saving and without a Fairlight connection.
- **Edit device:** the gear button opens a large view of the unit. On the main unit, click F1–F8 or any right-hand key to assign it; reserved keys and modifiers stay locked. With fixed mode, click a channel strip to choose its target.
- **Assignment:** fixed or banking per device. Fixed devices choose one channel or bus per fader. Banking devices share the rest.
- **Targets:** choose buses and inputs. A target that is already fixed on another fader is locked.
- **Ports:** shows whether each port was found, with reasons such as "input missing" or "device disabled".
- **LCD:** colors, line modes, overrides and a live preview.
- **Save:** validates the complete configuration and replaces the file atomically. Changes take effect after the bridge restarts.
- **Language:** German or English, switched in the page header.

The page only loads local files, checks the origin of write requests, and sets a Content Security Policy. Its editing views do not write to Fairlight and do not move motors. **Find** is the only action that sends MIDI, and it only blinks the SELECT LEDs. It is a setup tool, not a live mixing surface.

## Log level

`logLevel` accepts `debug`, `info`, `warn` or `error`. The default is `info`. Logs are written as JSON lines to stderr. Use `--pretty` for readable output while you test.
