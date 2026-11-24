# Desktop App

The desktop app installs the bridge like a normal program. It bundles its own
JavaScript runtime, so no Git, Node.js or terminal is needed.

## Install

Download the installer for your platform from
[Releases](https://github.com/cedricbetke/fairlight-xtouch-bridge/releases):

| Platform | File | Status |
|---|---|---|
| macOS 15 or newer on Apple Silicon | `.dmg` | Primary target, tested with real hardware |
| Windows 10/11 (x64) | `.exe` | Preview until USB MIDI is verified on Windows |
| Ubuntu 22.04/Debian 12 or newer (x64) | `.deb` | Preview until USB MIDI is verified on Linux |

Install it with the usual steps: open the `.dmg` and drag the app into
**Applications**, run the `.exe`, or install the `.deb` with your software
centre or `sudo apt install ./Fairlight-XTouch-Bridge-*.deb`.

The releases are not code-signed yet. macOS Gatekeeper and Windows SmartScreen
may therefore ask for confirmation the first time. The workflow is prepared for
signing certificates; until then, only install files from this repository's
release page.

## First start

1. Open **Fairlight X-Touch Bridge**. The settings page opens in your browser.
2. Select the MIDI ports of your X-Touch and extenders, choose the Fairlight
   host and port, and press **Speichern**.
3. Saving restarts the bridge with the new configuration. The app section at
   the top of the page shows whether the bridge is running and whether Fairlight
   and the X-Touch units are connected.

The bridge runs as long as the app is open. Closing the browser tab does not
stop it. Quit the app through the tray or menu bar icon (**Beenden**) to stop
the bridge and release the MIDI ports.

## Tray and menu bar

The icon shows the current state and offers:

- **Einstellungen öffnen** – open the settings page again.
- **Bridge bei der Anmeldung starten** – start the app automatically after login.
- **Beenden** – stop the bridge and quit the app.

A second launch focuses the settings page of the running instance instead of
starting a second bridge.

Some Linux desktops have no tray. The bridge keeps running and the application
entry opens the settings page again. To stop the running instance without a
tray icon, start the app with `--quit` from a terminal, for example
`"/opt/Fairlight X-Touch Bridge/fairlight-xtouch-bridge" --quit`.

## Autostart

Autostart is off by default. Enable it either in the app section of the settings
page or in the tray menu. It starts the app in the background without opening a
browser window.

The login item is per user:

- macOS: login item of the app.
- Windows: entry in the current user's startup items.
- Linux: XDG autostart entry in `~/.config/autostart/fairlight-xtouch-bridge.desktop`.

Turn autostart off before uninstalling, or remove the login item manually.

## Writes, motors and targets

Fairlight writes and motor movement are **off after every app start**, even
when autostart is enabled. Enable them for the current session in the app
section:

- **Schreibzugriffe auf Fairlight erlauben** – required for faders, mute, pan,
  sends and monitor dim.
- **Motoren bewegen** – additionally required for moving faders.

Both permissions end when the app quits; they are not stored. On top of that,
each target must be listed under **Schreibziele in der Konfiguration**:

| Field | Example | Meaning |
|---|---|---|
| Kanäle | `1, 2, 3` | Channel numbers that may be written |
| Busse | `main:1, aux:2` | Buses in `type:index` form |
| Monitore | `1` | Monitor numbers that may be dimmed |

Empty lists allow nothing. The bridge never adds targets on its own.

## Files and logs

| Platform | Configuration, preferences and logs |
|---|---|
| macOS | `~/Library/Application Support/Fairlight X-Touch Bridge/` |
| Windows | `%APPDATA%\Fairlight X-Touch Bridge\` |
| Linux | `~/.config/fairlight-xtouch-bridge/` |

- `bridge.json` – the bridge configuration. Saving in the settings page updates it.
- `app.json` – app preferences such as autostart.
- `logs/bridge.log` – structured log; rotated to `bridge.log.1` on the next start once it exceeds 5 MB.

Set `FAIRLIGHT_BRIDGE_DATA_DIR` to use another directory. Set
`FAIRLIGHT_BRIDGE_LOG_LEVEL` to `debug`, `info`, `warn` or `error` for a more
detailed log before starting the app.

## Updates

Install the new version over the old one. The configuration in the user data
directory is kept. If the release notes mention a configuration change, check
the app section after the update.

## Build installers locally

```bash
npm ci
npm run build
npm run app        # start the Electron app from source
npm run app:dist   # build the installer for the current platform
```

Installers are written to `release/`. Tagged releases (`v*`) build macOS,
Windows and Linux packages in GitHub Actions and attach them to a draft
release. Signing and notarisation need the usual `CSC_LINK`,
`CSC_KEY_PASSWORD` and Apple ID secrets; without them the packages are
unsigned.
