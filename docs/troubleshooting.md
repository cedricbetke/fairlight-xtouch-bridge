# Troubleshooting

Start with `doctor`. It checks most of the points below in one run and tells you which ones need attention:

```bash
npm run dev -- doctor --config config/bridge.json
```

`doctor` sends no MIDI, writes nothing to Fairlight and does not move motors, so it is safe to run at any time.

## MIDI

### A port is not found or `midi list` shows no match

- Port names must match what macOS (CoreMIDI) reports, character for character. Copy the name from `midi list`.
- Check that the unit is powered and connected over USB, and that it is in **MC** mode.
- Check that no other app has the same ports open. In particular, disable the native Fairlight MCU control for those ports.
- Look for the error `assigned to both`. It means two configured devices point at the same port. Give each device its own port and occurrence.

### Two extenders show the same port name

Both extenders report the same name, for example `X-Touch-Ext X-TOUCH_INT`. The bridge tells them apart by `occurrence` (0 and 1), and the order of occurrences can differ from the physical order.

To check:

1. Run `npm run dev -- midi monitor --device extender1 --duration 20 --config config/bridge.json`.
2. Touch and move a fader on the unit you intended as `extender1`.
3. If the messages appear on the other unit, swap the `occurrence` values of the two extenders in the configuration.

Re-check after you unplug and re-plug a unit, since the order can change.

### Extender disappears after a USB replug

After a USB replug, macOS sometimes does not enumerate the extender again. Power-cycle the extender (switch it off and on). The bridge picks the device up again as soon as it appears. A cascade through the USB hub of an extender produced duplicate or silent MIDI ports during testing, so connect each unit to its own USB path.

### The bridge reports duplicate ports or nothing sounds

- Connect each unit to its own USB path, directly to the Mac or to a separate hub port.
- Run `midi list` again after changing the cabling.

### Settings page shows "not found"

The settings page shows input and output separately, with a reason in the summary:

- "Input missing" or "Output missing": the name is not present in macOS. Correct the name, or press **Rescan ports** after plugging the device in.
- "Device disabled": the device is turned off in the configuration.
- "MIDI list unavailable": the bridge could not read the MIDI ports at all. See the native library section below.

A missing selection stays visible and is never silently switched to another device with the same name.

## Fairlight connection

### `discover` finds nothing, or the connection fails

- Fairlight Live must be running with a show loaded.
- Ember+ must be enabled: **File → Show Settings → Ember+ → Enable**.
- Check the port: use the value Fairlight shows, and set `fairlight.port` (or `--port`) to match.
- Check the host: for a bridge on the same Mac, use `127.0.0.1`.
- Test the client without Fairlight:
  ```bash
  npm run dev -- mock-ember --port 19000
  npm run dev -- discover --host 127.0.0.1 --port 19000
  ```

### The bridge keeps reconnecting

This is expected while Fairlight is closed or restarting. Retries back off up to 10 seconds. Set `fairlight.reconnectAttempts` to a positive number if you want the bridge to give up after a fixed number of attempts. Otherwise it retries without limit.

### Channel numbers shifted after I changed the show

The bridge maps strips by Ember+ channel number and by position. Fairlight has no stable channel ID, so reordering channels during a show moves the strips to the new order. The bridge notices structure changes, locks writes and motors briefly, and takes over the new structure once rediscovery succeeds. Avoid reordering channels during a live show.

If you use single-channel test mode with `singleChannelName`, the lock stays in place when the name is missing or appears twice. Fix the name in the show or in the configuration.

## Faders, mutes and motors

### Faders move on the surface but Fairlight does not change

Check, in this order:

1. The bridge was started with `--arm-writes`. Without it, nothing is written.
2. The channel is in `safety.allowedWriteChannels`. A channel that is reachable through banking but not in the list stays locked.
3. `doctor` does not warn about the target being **read-only**. This means the channel's level is not writable in the show.
4. The fader was touched. With `requireTouchForWrites` on, moves without touch are ignored.

### Motors do not move

- Start with `--arm-motor` (and `--arm-writes`).
- Motors are aligned once after discovery, after a bank change, after a reconnect and after an accepted structure change, unless `alignMotorsOnStart` or `alignMotorsOnBankChange` is set to `false`. They do not move while the strip is touched.
- After that one-time alignment, each strip needs a touch and release before it follows Fairlight changes continuously. After a failed write, the strip stays locked until Fairlight reports a fresh value for that field; then touch and release the fader.

### A strip stays locked after a failed write

When a write fails or is not confirmed, the bridge locks that strip until Fairlight reports a fresh value for that exact field. After that, touch and release the fader. This is intended: it prevents an old value from being written back into the show.

### The mute LED does not change

The LED follows the state Fairlight confirms, not the button. If the LED does not change, check that the channel is writable and that the change reached Fairlight. Then check the Fairlight channel in the show.

### Motors stop short of the top or bottom

The motor end stops do not reach the last millimeters, so a small manual movement remains at each end. This is a hardware limit.

### Fader values look off by a little

The fader curve was measured on one X-Touch and is stored as a piecewise linear curve. Other units or firmware versions may need a new measurement. See [Technical Reference](research.md) and [Hardware Testing](hardware-test.md).

## Settings and configuration

### My changes in the settings page did not take effect

Saving validates and writes the complete configuration, but the running bridge reads it at start. Restart the bridge to apply device order, fixed or banking assignment, MIDI ports and button assignments.

### Saving fails with a validation error

The error message names the key that is wrong (for example `mapping.layout.surfaces.main.fixedTargets`). Fix that key in the configuration file, or correct the value in the settings page and save again. Run `config validate` to see all errors at once:

```bash
npm run dev -- config validate --config config/bridge.json
```

### An LCD override shows as paused

The Fairlight name no longer matches `expectedName`. Check the channel name in the show. If the name is correct, press **Update** in the settings page to bind the override again.

### A channel shows `NO SEND` in Sends on Fader

The channel has no send to the selected aux in the show. The bridge does not create sends. Add the send in Fairlight or choose another aux.

### A function key does nothing

- For *Sends on Fader*, the aux bus must exist in the show.
- For *Monitor-Dim*, the monitor must exist and must be listed in `safety.allowedWriteMonitors`.
- Assignments are stored by number. If the target is not present in the show, the key stays inactive but keeps its assignment.

## Installation

### Node.js version errors

The project requires Node.js **26 LTS** (26.0 or newer). Node.js 22 is not supported by the Ember+ library in use. Use `nvm use` (the repository's `.nvmrc` contains `26`) or install Node.js 26.

### The native MIDI library does not load

Install the Xcode Command Line Tools, then rebuild the native module:

```bash
xcode-select --install
npm rebuild @julusian/midi
```

## Still stuck?

- Run `doctor --json` and include the output in your report.
- Run the bridge with `--pretty` and `logLevel: "debug"` to see the event sequence.
- Open an issue on GitHub with your macOS version, Fairlight Live version, Node.js version, the unit models and firmware, and the steps to reproduce.
