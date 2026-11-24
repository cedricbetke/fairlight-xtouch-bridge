# Getting Started

This guide takes you from a fresh checkout to a first safe test with real hardware. Read it once from start to finish before you connect the X-Touch to a show.

If you only want to try the software, the [Quick start in the README](../README.md#quick-start-no-hardware-needed) is enough.

## 1. Prepare Fairlight Live

1. Start Fairlight Live 1.1.1 and load a test show.
2. Enable Ember+: **File → Show Settings → Ember+ → Enable**.
3. Note the server port shown there. The default in this project is `9000`.
4. Turn off the native Fairlight MCU control for the X-Touch ports. The bridge and the macOS MIDI driver must be the only users of those ports.

## 2. Prepare the X-Touch units

- Set the X-Touch and each X-Touch Extender to **MC** mode. Do not use HUI or Ctrl mode.
- Connect each unit to its own USB path, directly to the Mac or to a separate hub port. A USB cascade through the hub of an extender produced duplicate or silent MIDI ports during testing.

## 3. Install the software

### Desktop app (recommended)

Download the installer from [Releases](https://github.com/cedricbetke/fairlight-xtouch-bridge/releases) and install it:

- macOS: open the `.dmg` and drag the app into **Applications**.
- Windows: run the `.exe` (preview).
- Linux: install the `.deb` with your software centre or `apt` (preview).

Open the app and continue with step 4 in the browser page. The app stores its configuration in the user data directory; see [Desktop App](desktop-app.md) for paths, tray behaviour and autostart.

### From source

Requirements: macOS with Apple Silicon and Node.js 26 LTS.

```bash
git clone https://github.com/cedricbetke/fairlight-xtouch-bridge.git
cd fairlight-xtouch-bridge
nvm use            # optional; .nvmrc contains 26
npm ci
npm run build
npm test
```

`npm ci` runs the install scripts for `@julusian/midi` and `esbuild`, which are allowed in `package.json` under `allowScripts`.

If the native MIDI library does not load, install the Xcode Command Line Tools and run:

```bash
npm rebuild @julusian/midi
```

The remaining steps use the command line. With the desktop app, use the settings page instead: choose the ports there, load the channels and save. The app applies the configuration immediately.

## 4. Find the MIDI port names

```bash
npm run dev -- midi list
```

This shows every MIDI input and output, and how the configured devices map to those ports once a configuration file exists. Names must match exactly what macOS (CoreMIDI) reports.

Typical names on macOS over USB:

| Unit | Port name |
|---|---|
| X-Touch (main) | `X-Touch INT` |
| X-Touch Extender | `X-Touch-Ext X-TOUCH_INT` |

Two extenders report the same name. Use `occurrence: 0` for the first and `occurrence: 1` for the second. The order can differ from the physical order, so check it with a fader test (see [Troubleshooting](troubleshooting.md#two-extenders-show-the-same-port-name)).

## 5. Create the single-channel configuration

`discover`, `doctor`, `midi monitor` and `run` read the configuration file, so create it now:

```bash
cp config/bridge.poc.example.json config/bridge.poc.json
```

Edit `config/bridge.poc.json`:

- Set the main unit's port names in `midi.devices`.
- Set `fairlight.port` if your Ember+ server uses another port.

Leave `mapping.singleChannel` at `1` and `safety.allowedWriteChannels` at `[1]`. The channel name is filled in after the next step.

## 6. Check the Ember+ connection

```bash
npm run dev -- discover --config config/bridge.poc.json
```

Expected: the channels that exist in your show, with name, fader value, mute state and write access. The output is dynamic. The bridge does not assume fixed node IDs.

If nothing is found, check the port number and that Ember+ is enabled in Fairlight.

Then set `mapping.singleChannelName` in `config/bridge.poc.json` to the name that `discover` shows for channel 1. Without that name, `run` refuses to arm writes in single-channel mode.

## 7. Run the startup check

```bash
npm run dev -- doctor --config config/bridge.poc.json
```

`doctor` checks the MIDI ports, the Fairlight connection, the configured targets and the write allowlists. It prints `OK`, `WARN` or `FAIL` per check and exits with code 1 only on `FAIL`.

It sends no MIDI, writes nothing to Fairlight and moves no motors. Review every `WARN` before you go on.

## 8. First test with one channel

1. Check the raw MIDI from the fader. Touch fader 1, move it slowly, and let go:

   ```bash
   npm run dev -- midi monitor --device main --duration 20 --config config/bridge.poc.json
   ```

   You should see a touch message `[144,104,127]`, fader messages starting with `224`, and a release `[144,104,0]`.

2. Start the bridge with explicit permission:

   ```bash
   npm run dev -- run --config config/bridge.poc.json --arm-motor --arm-writes --pretty
   ```

3. Touch fader 1 and pull it to about −20 dB. Channel 1 in Fairlight should take the value, and the motor should stay still while you touch.
4. Let go. The motor should move to the value Fairlight confirms. Change the level in Fairlight; the motor should follow.
5. Press **Mute** on strip 1. The LED should change only after Fairlight confirms the change.
6. Unplug USB briefly, then disconnect Fairlight briefly. After reconnecting, no old fader value should be written and no old gesture should be replayed. The motors align once to the confirmed values; before a strip follows Fairlight continuously again, touch and release its fader once.

Record the results in your own notes. The [Hardware Testing](hardware-test.md) guide has the full acceptance list.

## 9. Move to the full setup

Once the single-channel test passes:

```bash
cp config/bridge.example.json config/bridge.json
npm run dev -- midi list --config config/bridge.json
npm run dev -- discover --config config/bridge.json
npm run dev -- doctor --config config/bridge.json
npm run dev -- run --config config/bridge.json --arm-motor --arm-writes --pretty
```

`mapping.master.busType` and `busIndex` must match the bus structure in your show. `discover` lists the buses it finds. The bridge never guesses a bus.

The example configuration sends 24 channels to the write allowlist, which is only safe when your show contains those channels. Adjust `safety.allowedWriteChannels` to the channels you actually want the surface to control. See [Configuration](configuration.md).

## Ethernet instead of USB (optional)

An X-Touch or Extender can also run over Ethernet. Set the unit to `MC` → `NETWORK` → RTP **SLAVE** and give it an IP address. Use [`config/bridge.network.example.json`](../config/bridge.network.example.json) as a starting point and set `network.host` and `network.port` to the values shown on the unit (default control port 5004; the bridge also uses 5005 for MIDI data). USB selectors are not needed for network devices.

Check the transport before arming writes:

```bash
npm run dev -- midi list --config config/bridge.network.json
npm run dev -- midi monitor --device extender1 --duration 20 --config config/bridge.network.json
npm run dev -- doctor --config config/bridge.network.json
```

`doctor` opens a short RTP-MIDI session for each network device. If the unit accepts only one session, stop the bridge before running the check. The settings page can test a connection the same way.

The bridge is the session initiator. It does not implement Bonjour discovery or RTP **MASTER**, and **Find** remains USB-only. A mixed setup (main on USB, extenders on Ethernet) is supported.

## Motor alignment on start

After a successful discovery, the bridge moves the motors once to the confirmed Fairlight values, as long as motors are armed (`--arm-motor` together with `--arm-writes`) and the strip is not touched. The surface is then in sync without touching every fader first. This is a one-time move: after it, motors follow confirmed Fairlight values as usual.

To turn this off, set `"alignMotorsOnStart": false` in `safety`. See [Configuration → Safety](configuration.md#safety).

## Hardware-free soak (optional)

Before longer sessions, run the soak. It keeps the full bridge running against an in-process mock Fairlight provider and virtual X-Touch surfaces over TCP, with randomized faders, mutes, banking, provider restarts and extender replugs:

```bash
npm run dev -- soak --minutes 30
```

It prints a status line every 10 seconds and a final summary. It never opens real MIDI ports and never touches Fairlight. Exit code 1 means an invariant failed; keep the output. The soak replaces neither the hardware acceptance tests nor a real show.

## Run as a background service (optional)

`deploy/com.example.fairlight-xtouch-bridge.plist` is a template for a user launch agent. Replace the placeholder paths, label and log directory first:

```bash
mkdir -p ~/Library/Logs/FairlightXtouchBridge
cp deploy/com.example.fairlight-xtouch-bridge.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.fairlight-xtouch-bridge.plist
launchctl kickstart -k gui/$(id -u)/com.example.fairlight-xtouch-bridge
```

The agent starts the bridge with arming enabled. Check the allowlist in `config/bridge.json` before you install it. The autostart setup has not been tested on macOS yet, so run the bridge manually first.

## Next steps

- [Configuration](configuration.md): devices, banking, LCD, function keys, safety settings
- [Troubleshooting](troubleshooting.md): when something does not behave as expected
- [Hardware Testing](hardware-test.md): acceptance tests and results
