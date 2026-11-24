# Hardware acceptance on macOS

This guide is for testing with real hardware. On 22 Nov 2026, tests 0–11 were run in a test show on a studio Mac with an X-Touch and two extenders: faders, mutes, master, banking, hotplug, Fairlight reconnect, structure changes and LCD channel names work. Continuous operation, sleep/wake and launchd remain pending. Please document results and deviations.

## Preparation

- Start Fairlight Live 1.1.1 and load the test show.
- **File → Show Settings → Ember+ → Enable**. Note the port.
- Set the X-Touch to **MC** mode. Set both extenders to **MC** as well, not HUI/Ctrl.
- Only the bridge and the macOS MIDI driver may open the X-Touch ports. Disable Fairlight's native MCU control for the same ports.
- Make sure Node.js 26 LTS is active in the terminal. Open a terminal in the project folder:
  ```bash
  npm ci
  npm run build
  npm test
  ```
- Create a copy of the PoC configuration and adjust it:
  ```bash
  cp config/bridge.poc.example.json config/bridge.poc.json
  ```

## Test 0: Ports and configuration

```bash
npm run dev -- midi list --config config/bridge.poc.json
```

Expected:

- Main input and main output are found under exactly the name given in the configuration.
- No "assigned to both" error message.
- If the name differs: correct the configuration; do not let the bridge guess.

Also run the bundled startup diagnostics:

```bash
npm run dev -- doctor --config config/bridge.poc.json
```

Expected:

- No `FAIL` line and exit code 0.
- Deliberately review every `WARN` line: duplicate port names, targets not released, or missing allowlist entries.
- The command sends no MIDI messages and writes nothing to Fairlight.

## Test 1: Raw MCU data

```bash
npm run dev -- midi monitor --device main --duration 20 --config config/bridge.poc.json
```

Touch fader 1, move it slowly, release it. Expected JSON lines (examples):

```json
{"message":[144,104,127],"decoded":{"type":"touch","strip":0,"touched":true}}
{"message":[224,0,64],"decoded":{"type":"fader","strip":0,"raw":8192}}
{"message":[144,104,0],"decoded":{"type":"touch","strip":0,"touched":false}}
```

Press mute 1:

```json
{"message":[144,16,127],"decoded":{"type":"button","button":"mute","strip":0,"pressed":true}}
```

If no messages appear: wrong port, device not in MC mode, or another program is holding the port.

## Test 2: Ember+ structure

```bash
npm run dev -- discover --config config/bridge.poc.json
```

Expected:

- Channels are listed with names and values.
- Channel 1 is the intended test channel.
- `writable=level,mute` is set.
- Buses are only shown if they exist in the show.

Enter the displayed name of channel 1 as `mapping.singleChannelName` in `config/bridge.poc.json`. The name must be unique in the show. Without this name, `run --arm-writes` refuses to start in single-channel mode. Then:

```bash
npm run dev -- config validate --config config/bridge.poc.json
```

Expected: `expectedName=<your channel name>`. If the name does not match exactly, the bridge stays locked later on.

If channel names are empty or wrong: do not continue with write access. Check the debug log:

```bash
npm run dev -- discover --config config/bridge.poc.json --log-level debug
```

Also check that a wrong port fails quickly and cleanly:

```bash
npm run dev -- discover --host 127.0.0.1 --port 19999
```

Expected: error message and exit code 1 within a few seconds; the process does not hang.

## Test 3: Simulation as software cross-check

```bash
npm run dev -- simulate
```

Expected: 46 `PASS` lines and `Simulation complete: 46 checks passed`. This only tests the software, not Fairlight or the X-Touch.

## Test 4: One fader, read only

Start the bridge without arming:

```bash
npm run dev -- run --config config/bridge.poc.json --pretty
```

Expected:

- No motor movement at startup.
- A fader change in Fairlight does **not** move the X-Touch fader, because motors are not enabled.
- Moving the fader on the X-Touch writes **nothing** to Fairlight.
- Mute LEDs may show the confirmed Fairlight state.

## Test 5: One fader, write and motor

Restart the bridge with explicit enabling:

```bash
npm run dev -- run --config config/bridge.poc.json --arm-motor --arm-writes --pretty
```

At startup, the motors move once to the confirmed Fairlight values, without any fader being touched. After that:

1. Touch fader 1 and drag it to approx. −20 dB.
   - Expected: Fairlight channel 1 follows; the motor stays still while touched.
2. Release.
   - Expected: motor moves to the value confirmed by Fairlight.
3. Change channel 1 to −10 dB in Fairlight.
   - Expected: motor moves to −10 dB.
4. Touch fader 1 but do not move it. Change to −30 dB in Fairlight.
   - Expected: motor stays still while touched.
5. Release.
   - Expected: motor then moves to −30 dB.

If the motor moves to an old value after release: stop immediately and save the log. This is a safety bug.

### Fader calibration

The curve is stored as piecewise linear interpolation in `src/mcu/faderLaw.ts`. Measured anchor points on an X-Touch (14-bit raw value at the respective printed mark):

| Marking | Raw value | Position |
|---|---|---|
| −∞ (lower end stop) | 0 | 0 % |
| −60 | 620 | 3.8 % |
| −50 | 1536 | 9.4 % |
| −40 | 2800 | 17.1 % |
| −30 | 3996 | 24.4 % |
| −20 | 6188 | 37.8 % |
| −10 | 8380 | 51.2 % |
| −5 | 10468 | 63.9 % |
| 0 | 12700 | 77.5 % |
| +5 | 14736 | 90.0 % |
| +10 | 16383 | 100 % |

The motorized end stops do not reach the last few millimeters. A small residual travel remains at the top and bottom, which can only be reached by hand. This is known X-Touch behavior and not a bridge bug.

For a different device or firmware version, re-measure the table:

| Fairlight dB | X-Touch fader position (visual) | Actual dB value after read-back |
|---|---|---|
| −60 | | |
| −30 | | |
| −12 | | |
| 0 | | |
| +10 | | |

If the deviation is greater than approx. 1 dB, the bridge must not be approved for live use until a suitable curve is implemented.

## Test 6: Mute

1. Press mute 1 on the X-Touch.
   - Expected: Fairlight channel 1 is muted; the LED only switches after the change is confirmed.
2. Press mute 1 again.
   - Expected: channel is audible again; LED off.
3. Change the mute in Fairlight with the mouse.
   - Expected: the X-Touch LED follows.

## Test 7: Fairlight interruption

1. Quit Fairlight or disable Ember+ in the Show Settings.
   - Expected: bridge reports `fairlight.disconnected`; writes and motors stop.
2. Move faders while disconnected.
   - Expected: no writes.
3. Restart Fairlight / re-enable Ember+, and change the channel value in Fairlight while doing so.
   - Expected: bridge reconnects, reads the current value, does not write an old value, and aligns the motor to the current value.

## Test 7b: Structure change

Only in a test show:

1. Start the bridge with `mapping.singleChannelName` set and successfully write fader 1 once.
2. Rename channel 1 in Fairlight.
   - Expected: log `sync.single_channel_identity_mismatch` and `sync.structure_locked` (or `fairlight.structure_change_detected`, if Fairlight additionally sends a structure message).
3. Move fader 1.
   - Expected: no write; no motor movement.
4. Restore the channel name or adjust it in the configuration.
   - Expected: after successful re-detection, the bridge adopts the structure automatically; writing is possible again once the identity check passes. No bridge restart required.

If the structure message does not appear and the bridge keeps writing even though the name has changed: stop immediately and save the log.

## Test 7c: Add/remove/reorder channels

Only in a test show:

1. Add a channel **at the end** in Fairlight.
   - Expected: bridge briefly locks (`structure-change-detected`/`structure-changed`), re-detects, logs `sync.structure_accepted`, and keeps running without restart. `channelCount` increases; the new channel is reachable via banking.
2. **Remove** or **reorder** a channel.
   - Expected: likewise a brief lock, followed by automatic adoption. Strips without a target stay put; the rest follow the new channel order.
3. In single-channel mode with `singleChannelName`, deliberately create a duplicate name.
   - Expected: lock remains until the name is unique again.

If the new channel is outside `safety.allowedWriteChannels`, it is mapped but remains write-protected.

## Test 8: MIDI hotplug

1. Unplug the X-Touch while a fader is being touched.
   - Expected: bridge marks the device offline; no further motor/LED commands.
2. Plug the X-Touch back in.
   - Expected: port is opened again; the motors align to the confirmed Fairlight values.
   - If macOS does not re-detect the extender after a plain USB replug: switch the extender off and back on at its power switch.

## Test 9: Two extenders

Only after the single-channel test has passed:

```bash
cp config/bridge.example.json config/bridge.json
npm run dev -- midi list --config config/bridge.json
npm run dev -- discover --config config/bridge.json
npm run dev -- run --config config/bridge.json --arm-motor --arm-writes --pretty
```

On macOS the ports are called `X-Touch INT` (main unit) and `X-Touch-Ext X-TOUCH_INT` (extender). Both extenders use the same name, with `occurrence: 0` and `1` respectively. The example configuration uses generic names and must be adjusted accordingly.

The extenders stay in **MC** mode with **USB** interface (no "MC XT" in their menu). Connect each extender on its **own USB path**; do not daisy-chain through another extender's USB hub: in testing, the cascade produced a duplicate or silent MIDI port. Both extenders report the same port name; the occurrence order may differ from the physical order. After connecting, check with fader 1 on both extenders and swap the occurrences if needed.

Check:

- Main strip 1 → Fairlight channel 1.
- Extender 1 strip 1 → Fairlight channel 9.
- Extender 2 strip 1 → Fairlight channel 17.
- Both extenders are detected separately; no duplicate port assignment.
- Mute and motor work on all 24 strips.
- Master fader controls the configured bus (`discover` must show it).

## Test 10: Banking (optional, only with > 24 channels)

The example configuration fixes the main unit to channels 1–8 and puts both extenders in banking mode. The bank width is therefore 16 (eight strips per banking device), and only the extenders change targets; the main unit keeps its fixed channels. With exactly 24 channels there is no second bank.

Note: `safety.allowedWriteChannels` in the example covers channels 1–24. To see motor alignment on bank 2 and above, add the higher channels to the allowlist first.

- With more channels, press Bank right when no fader is being touched.
  - Expected: the extenders jump to the next 16 channels; the main unit keeps channels 1–8. The motors automatically move to the confirmed levels of the new targets (`alignMotorsOnBankChange`, default on). Strips without a target keep their position.
  - With 56 channels: bank 2 → Main 1–8 = channels 1–8 (fixed), Extender 1 = 25–32, Extender 2 = 33–40; bank 3 → Extender 1 = 41–48, Extender 2 = 49–56.
  - If `alignMotorsOnBankChange` is off: motors stay put and are only aligned per strip by touch/release.
- Press bank while a fader is being touched.
  - Expected: bank change is ignored and logged.

## Test 11: LCD channel names and colors

1. Start the bridge with write/motor enabled.
   - Expected: main strips show channel names 1–8, extender 1 channels 9–16, extender 2 channels 17–24. The bottom line shows `CH n` in each case. Inputs have a white background.
2. On the settings page, under **LCD display**, check the type colors (input white, main red, aux cyan) and set an exception with a short name. Save and restart the bridge.
   - Expected: the backgrounds match the type colors; the channel with the exception shows its short name and its own color.
   - Additionally, set one line to **Fader value (dB)** (e.g. line 1 name, line 2 value) and restart.
   - Expected: the second line shows the confirmed level, such as `-12.0dB`; changes in Fairlight update the text without touching the fader. Unknown values show `--`.
3. In **SEND** mode, set the lines to **Active fader target** and **Fader value**.
   - Expected: the display shows `AUX n` and the send level. Channels without this send show `NO SEND` on both lines. `PAN` switches back to the main mix values.
4. If the show contains VCAs: choose a VCA as a fixed target and check in the Ember+ tree whether a root `vca` or `dca` appears.
   - Expected: the VCA appears as a bus target and gets the VCA type color; otherwise VCA support remains unconfirmed.
5. Press **Bank right**.
   - Expected: the displays switch to the names and colors of the new bank (channels 25–32, 33–40, 41–48, etc.).
6. Rename a channel in Fairlight.
   - Expected: after the brief structure detection, the affected display updates. If the channel had an exception with an expected name, it falls back to the type color.
7. Strips without a target (e.g. bank 3, extenders) show empty displays and no background color.

Device bytes: main `0x14`, both extenders `0x15`. With other firmware they may differ; in that case verify with an LCD test.

## Test 12: Sends on Fader

Prerequisite: the show has an aux (e.g. Aux 2) with assigned channel sends, and the configuration contains `"sendsOnFader": { "enabled": true, "busIndex": 2 }`. The affected channels must be listed in `allowedWriteChannels`.

1. Start the bridge with `--arm-writes --arm-motor` and press **SEND** on the main X-Touch.
   - Expected: LCD at the bottom shows `AUX 2`; the motors move to the confirmed send levels. Channels without an Aux 2 send show `NO SEND` and do not move.
2. Touch and drag a fader.
   - Expected: the aux send level in Fairlight changes; the main channel level remains unchanged. After release, the motor moves to the confirmed send level.
3. Change the send level in Fairlight.
   - Expected: the motor follows, as long as the strip is not touched.
4. Press **MUTE**.
   - Expected: the channel is muted, not the send. The LED follows the confirmed channel mute.
5. Press **BANK right**.
   - Expected: the sends of the new bank are on the faders; motors are aligned.
6. Press **PAN**.
   - Expected: back to the main mix; motors move to the channel levels, LCD shows `CH n` again.
7. Press SEND while a fader is being touched.
   - Expected: the mode change is ignored.
8. While a touch is ongoing, disconnect Fairlight.
   - Expected: no send level is re-sent after reconnect; the strip needs a new touch gesture.

## Test 13: Key assignment F1–F8

Prerequisite: on the settings page, the large view was opened via the **gear icon "Bearbeiten"** on the main device, F1 and F2 were assigned to two different aux mixes and saved; the bridge was restarted.

1. Press **F1**.
   - Expected: the faders show the aux mix of F1, the bottom LCD shows `AUX 1`, the F1 LED is on. The motors move to the confirmed send levels.
2. Press **F2**.
   - Expected: switch to the second aux mix; motors, LCD and LED follow. A fader that is touched during this prevents the switch.
3. Press an unassigned key such as **F3**.
   - Expected: nothing happens.
4. Press a key whose aux is missing from the show.
   - Expected: the previous mix stays active; the bridge logs `sync.send_aux_missing`.
5. Press **PAN**.
   - Expected: back to the main mix, motors on the channel levels, PAN LED on.
6. After a bridge restart, check the assignments again.
   - Expected: the saved keys work unchanged.

## Test 13b: Right-hand main keys

Prerequisite: in the key editor, **PLAY** is additionally assigned to an aux mix and **MARKER** to **Monitor-Dim**, and saved; the bridge was restarted. `BANK`, `CH`, `SEND`, `PAN/SURR` and `FLIP` cannot be assigned and keep their function.

1. Press **PLAY**.
   - Expected: the faders show the aux mix of PLAY, the bottom LCD shows `AUX n`, the PLAY LED is on. **PAN** switches back, the LED goes off.
2. Press **MARKER**.
   - Expected: Fairlight switches the monitor to Dim; the MARKER LED lights up only after confirmation. A second press switches Dim off.
3. Check releasing an assigned key.
   - Expected: only the press triggers; releasing does not trigger anything again.
4. Press **BANK**, **CH**, **SEND** and **PAN**.
   - Expected: unchanged behavior; no assignment is triggered.
5. Press extender keys.
   - Expected: no effect; the assignment only applies on the main unit.

## Test 14: Monitor-Dim on F3

Prerequisite: on the settings page, **F3** on the main unit is assigned to **Monitor-Dim** with the desired monitor and saved; the bridge was restarted. The monitor is listed in `safety.allowedWriteMonitors`. `discover` shows the selected monitor under `Monitors` with `writable=dim`.

1. Start the bridge with `--arm-writes` and press **F3**.
   - Expected: Fairlight switches the monitor to Dim; the F3 LED lights up only after confirmation.
2. Press **F3** again.
   - Expected: Dim turns off; the LED goes off.
3. Turn on Dim in Fairlight with the mouse.
   - Expected: the F3 LED lights up without the bridge writing.
4. Remove the monitor from `safety.allowedWriteMonitors` and restart the bridge.
   - Expected: F3 remains ineffective; the LED still shows the confirmed state, but nothing is written.
5. While Dim is active, disconnect and reconnect Fairlight.
   - Expected: the LED goes off when disconnecting. After reconnecting it shows the freshly read state; an old key press is not replayed.
6. Check with a show without monitor paths.
   - Expected: `/api/state` reports no monitors; a saved Monitor-Dim assignment is retained and the key remains ineffective.

## Acceptance criteria

For live approval, at least the following must be met:

- 24 channels and master stable over several hours.
- No unintended fader movement except the documented startup, bank and structure alignment; during the structure check the motors stay locked.
- No write without touch and without arming/allowlist.
- Monitor-Dim writes only when armed and in `allowedWriteMonitors`; the LED shows only the confirmed dim state and goes off after a disconnect.
- After an unconfirmed write, the strip stays locked until a fresh Fairlight value is available; a new touch gesture is then required.
- After a structure message, the bridge locks immediately; after successful re-detection, the structure is adopted automatically (no restart), unless the single-channel name check fails.
- Fader curve within the accepted technical tolerance.
- Fairlight audio continues unaffected during a bridge abort, USB dropout and network interruption.
- Logs contain no unexpected retry or timeout storms.

## Logs for an error report

```bash
npm run dev -- run --config config/bridge.poc.json --arm-motor --arm-writes --log-level debug 2> bridge-debug.log
```

Please include:

- `bridge-debug.log`
- Output of `midi list`
- Output of `discover --json`
- Exact reproduction steps
- Fairlight version and X-Touch firmware
