import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, dialog, Menu, nativeImage, shell, Tray, type NativeImage } from "electron";

import { createLogger, isLogLevel, type Logger } from "../logger.js";
import { LinuxAutostart, NoopAutostart, type AutostartController } from "./autostart.js";
import { DesktopController } from "./controller.js";
import { defaultDataDir, logFilePath } from "./paths.js";

const APP_NAME = "Fairlight X-Touch Bridge";
const APP_ID = "de.fairlight-xtouch-bridge";
const HIDDEN_FLAG = "--hidden";
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const STATUS_INTERVAL_MS = 2000;

let controller: DesktopController | null = null;
let tray: Tray | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let quitting = false;

app.setName(APP_NAME);

function rotateLog(path: string): void {
  if (!existsSync(path)) return;
  try {
    if (statSync(path).size < MAX_LOG_BYTES) return;
    const previous = `${path}.1`;
    rmSync(previous, { force: true });
    renameSync(path, previous);
  } catch {
    // Logging must never keep the app from starting.
  }
}

function createAppLogger(dataDir: string): Logger {
  const path = logFilePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  rotateLog(path);
  const rawLevel = process.env["FAIRLIGHT_BRIDGE_LOG_LEVEL"] ?? "info";
  const level = isLogLevel(rawLevel) ? rawLevel : "info";
  return createLogger(level, {
    sink: (line) => {
      process.stderr.write(line + "\n");
      try {
        appendFileSync(path, line + "\n", "utf8");
      } catch {
        // Disk full or permission problems must not break the bridge.
      }
    },
  });
}

function runInBackground(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true;
  if (process.platform !== "darwin") return false;
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  } catch {
    return false;
  }
}

function loginItemOptions(): { path?: string; args: string[] } {
  if (process.defaultApp) {
    return { path: process.execPath, args: [app.getAppPath(), HIDDEN_FLAG] };
  }
  return { args: [HIDDEN_FLAG] };
}

class ElectronAutostart implements AutostartController {
  readonly supported = true;

  isEnabled(): boolean {
    try {
      return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: enabled });
  }
}

function createAutostart(): AutostartController {
  if (process.platform === "linux") {
    const args = process.defaultApp ? [app.getAppPath(), HIDDEN_FLAG] : [HIDDEN_FLAG];
    return new LinuxAutostart({ execPath: process.execPath, args });
  }
  if (process.platform === "win32" || process.platform === "darwin") return new ElectronAutostart();
  return new NoopAutostart();
}

function assetPath(name: string): string {
  return join(app.getAppPath(), "assets", name);
}

function trayImage(): NativeImage {
  const file = process.platform === "darwin" ? "trayTemplate.png" : "tray.png";
  const image = nativeImage.createFromPath(assetPath(file));
  if (process.platform === "darwin" && !image.isEmpty()) image.setTemplateImage(true);
  return image;
}

function buildMenu(logger: Logger): Menu {
  const info = controller?.info();
  const configured = info?.configExists ?? false;
  const running = info?.bridge.running ?? false;
  const bridgeLabel = !configured
    ? "Bridge: noch nicht eingerichtet"
    : running
      ? "Bridge: läuft"
      : "Bridge: gestoppt";
  const fairlightLabel = info?.fairlightConnected ? "Fairlight: verbunden" : "Fairlight: nicht verbunden";
  const devicesLabel =
    info && info.bridge.devicesEnabled > 0
      ? `X-Touch: ${info.bridge.devicesOnline} von ${info.bridge.devicesEnabled} online`
      : "X-Touch: keine Geräte";
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: bridgeLabel, enabled: false },
    { label: fairlightLabel, enabled: false },
    { label: devicesLabel, enabled: false },
  ];
  if (info?.bridge.lastError) {
    items.push({ label: info.bridge.lastError, enabled: false });
  }
  items.push(
    { type: "separator" },
    {
      label: "Einstellungen öffnen",
      click: () => {
        void controller?.openSettings();
      },
    },
    {
      label: "Bridge bei der Anmeldung starten",
      type: "checkbox",
      checked: info?.autostart ?? false,
      enabled: info?.autostartSupported ?? false,
      click: (item) => {
        void controller?.setAutostart(item.checked).then(
          () => refreshTray(logger),
          (error: unknown) => showError(logger, error),
        );
      },
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => app.quit(),
    },
  );
  return Menu.buildFromTemplate(items);
}

function refreshTray(logger: Logger): void {
  if (!tray) return;
  const info = controller?.info();
  const running = info?.bridge.running ? "läuft" : "gestoppt";
  tray.setToolTip(`${APP_NAME} · ${running}`);
  tray.setContextMenu(buildMenu(logger));
}

function buildTray(logger: Logger): void {
  try {
    const image = trayImage();
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.on("double-click", () => {
      void controller?.openSettings();
    });
    refreshTray(logger);
    statusTimer = setInterval(() => refreshTray(logger), STATUS_INTERVAL_MS);
    statusTimer.unref();
  } catch (error) {
    logger.warn("app.tray_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function showError(logger: Logger, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("app.error", { error: message });
  dialog.showErrorBox(APP_NAME, message);
}

async function main(): Promise<void> {
  app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin") app.dock?.hide();

  const dataDir = defaultDataDir();
  const logger = createAppLogger(dataDir);
  logger.info("app.launch", {
    version: app.getVersion(),
    platform: process.platform,
    dataDir,
    packaged: app.isPackaged,
  });

  controller = new DesktopController({
    dataDir,
    logger,
    autostart: createAutostart(),
    openExternal: (url) => shell.openExternal(url),
  });

  process.on("uncaughtException", (error) => {
    logger.error("app.uncaught_exception", { error });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("app.unhandled_rejection", { error: reason });
  });

  try {
    await controller.start({ hidden: runInBackground() });
  } catch (error) {
    showError(logger, error);
    app.exit(1);
    return;
  }
  buildTray(logger);
}

function shutdown(): void {
  if (quitting) return;
  quitting = true;
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  const active = controller;
  controller = null;
  if (!active) {
    app.exit(0);
    return;
  }
  void active.stop().finally(() => app.exit(0));
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  shutdown();
});

app.on("window-all-closed", () => {
  // The tray (or menu bar) keeps the bridge alive; quit through the tray menu.
});

app.on("activate", () => {
  void controller?.openSettings();
});

if (!app.requestSingleInstanceLock() || process.argv.includes("--quit")) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (commandLine.includes("--quit")) {
      app.quit();
      return;
    }
    if (commandLine.includes(HIDDEN_FLAG)) return;
    void controller?.openSettings();
  });
  void app.whenReady()
    .then(main)
    .catch((error: unknown) => {
      dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
}
