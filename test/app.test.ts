import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LinuxAutostart, desktopExecArgument, linuxDesktopEntry } from "../src/app/autostart.js";
import {
  appSettingsFilePath,
  configFilePath,
  defaultDataDir,
  logFilePath,
} from "../src/app/paths.js";
import { AppSettingsStore } from "../src/app/settings.js";
import { createLogger } from "../src/logger.js";
import { createDemoConfig } from "../src/settings/demo.js";
import { SettingsServer, type SettingsAppHost, type SettingsServerAddress } from "../src/settings/server.js";

const logger = createLogger("error", { sink: () => undefined });

describe("app paths", () => {
  it("uses the platform data directory", () => {
    assert.equal(
      defaultDataDir({ platform: "win32", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, home: "C:\\Users\\me" }),
      join("C:\\Users\\me\\AppData\\Roaming", "Fairlight X-Touch Bridge"),
    );
    assert.equal(
      defaultDataDir({ platform: "darwin", env: {}, home: "/Users/me" }),
      join("/Users/me", "Library", "Application Support", "Fairlight X-Touch Bridge"),
    );
    assert.equal(
      defaultDataDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/home/me/.config" }, home: "/home/me" }),
      join("/home/me/.config", "fairlight-xtouch-bridge"),
    );
  });

  it("honours the data directory override", () => {
    const override = join(tmpdir(), "bridge-data");
    assert.equal(
      defaultDataDir({ platform: "linux", env: { FAIRLIGHT_BRIDGE_DATA_DIR: override }, home: "/home/me" }),
      override,
    );
  });

  it("derives the file names from the data directory", () => {
    const directory = join(tmpdir(), "bridge");
    assert.equal(configFilePath(directory), join(directory, "bridge.json"));
    assert.equal(appSettingsFilePath(directory), join(directory, "app.json"));
    assert.equal(logFilePath(directory), join(directory, "logs", "bridge.log"));
  });
});

describe("app settings store", () => {
  it("starts with autostart off and persists changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-app-settings-"));
    try {
      const store = new AppSettingsStore(appSettingsFilePath(directory));
      assert.deepEqual(store.get(), { autostart: false });
      store.setAutostart(true);
      assert.equal(store.get().autostart, true);

      const reloaded = new AppSettingsStore(appSettingsFilePath(directory));
      assert.equal(reloaded.get().autostart, true);
      const stored = JSON.parse(readFileSync(appSettingsFilePath(directory), "utf8")) as { autostart: boolean };
      assert.equal(stored.autostart, true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ignores a broken settings file instead of failing to start", () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-app-settings-"));
    try {
      const path = appSettingsFilePath(directory);
      writeFileSync(path, "{not json", "utf8");
      assert.deepEqual(new AppSettingsStore(path).get(), { autostart: false });
      writeFileSync(path, JSON.stringify({ autostart: "yes" }), "utf8");
      assert.deepEqual(new AppSettingsStore(path).get(), { autostart: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("autostart", () => {
  it("quotes Exec arguments for the desktop entry", () => {
    assert.equal(desktopExecArgument("/opt/bridge"), "/opt/bridge");
    assert.equal(desktopExecArgument("/opt/Fairlight Bridge/app"), '"/opt/Fairlight Bridge/app"');
    assert.equal(desktopExecArgument("/opt/a$b"), '"/opt/a\\$b"');
    assert.equal(desktopExecArgument("100%"), "100%%");
  });

  it("writes and removes the Linux autostart entry", () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-autostart-"));
    try {
      const autostart = new LinuxAutostart({
        execPath: "/opt/Fairlight X-Touch Bridge/fairlight-xtouch-bridge",
        args: ["--hidden"],
        env: { XDG_CONFIG_HOME: directory },
        home: directory,
      });
      assert.equal(autostart.supported, true);
      assert.equal(autostart.isEnabled(), false);
      autostart.setEnabled(true);
      assert.equal(autostart.isEnabled(), true);
      const entry = readFileSync(autostart.entryPath, "utf8");
      assert.match(entry, /^\[Desktop Entry\]/);
      assert.match(entry, /Exec="\/opt\/Fairlight X-Touch Bridge\/fairlight-xtouch-bridge" --hidden/);
      autostart.setEnabled(false);
      assert.equal(autostart.isEnabled(), false);
      assert.equal(existsSync(autostart.entryPath), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders a complete desktop entry", () => {
    const entry = linuxDesktopEntry("/usr/bin/bridge", ["--hidden"]);
    assert.match(entry, /Type=Application/);
    assert.match(entry, /Name=Fairlight X-Touch Bridge/);
    assert.match(entry, /Exec=\/usr\/bin\/bridge --hidden/);
    assert.match(entry, /Terminal=false/);
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

describe("settings page in the desktop app", () => {
  let server: SettingsServer;
  let address: SettingsServerAddress;
  let directory: string;
  let configPath: string;
  let savedConfigs = 0;
  let autostart = false;
  let arming = { writes: false, motors: false };

  const appHost: SettingsAppHost = {
    info: () => ({
      autostart,
      autostartSupported: true,
      arming: { ...arming },
      bridge: {
        running: true,
        fairlightConnected: false,
        devicesOnline: 2,
        devicesEnabled: 3,
        lastError: null,
      },
      onAir: null,
      fairlightConnected: false,
      configPath,
      configExists: true,
    }),
    setAutostart: (enabled) => {
      autostart = enabled;
    },
    setArming: (next) => {
      arming = { ...next };
    },
    pauseBridge: async () => async () => undefined,
    configSaved: () => {
      savedConfigs += 1;
    },
  };

  before(async () => {
    directory = mkdtempSync(join(tmpdir(), "bridge-app-server-"));
    configPath = join(directory, "bridge.json");
    server = new SettingsServer({
      configPath,
      config: createDemoConfig(),
      demo: true,
      port: await freePort(),
      logger,
      autoDiscover: false,
      app: appHost,
    });
    address = await server.start();
  });

  after(async () => {
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  it("reports the app section in the state", async () => {
    const response = await fetch(`${address.url}/api/state`);
    assert.equal(response.status, 200);
    const state = (await response.json()) as {
      app?: { autostart: boolean; arming: { writes: boolean; motors: boolean }; bridge: { running: boolean } };
    };
    assert.ok(state.app);
    assert.equal(state.app?.autostart, false);
    assert.equal(state.app?.arming.writes, false);
    assert.equal(state.app?.bridge.running, true);
  });

  it("toggles autostart and session arming", async () => {
    const autostartResponse = await fetch(`${address.url}/api/app`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autostart: true }),
    });
    assert.equal(autostartResponse.status, 200);
    assert.equal(autostart, true);

    const writesResponse = await fetch(`${address.url}/api/app`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes: true }),
    });
    assert.equal(writesResponse.status, 200);
    assert.deepEqual(arming, { writes: true, motors: false });

    const motorsResponse = await fetch(`${address.url}/api/app`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motors: true }),
    });
    assert.equal(motorsResponse.status, 200);
    assert.deepEqual(arming, { writes: true, motors: true });
  });

  it("refuses motors without write access", async () => {
    const response = await fetch(`${address.url}/api/app`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes: false, motors: true }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(arming, { writes: true, motors: true });
  });

  it("saves without asking for a manual bridge restart", async () => {
    const stateResponse = await fetch(`${address.url}/api/state`);
    const state = (await stateResponse.json()) as {
      layout: unknown;
      lcd: unknown;
      devices: unknown[];
      config: { fairlight: { host: string; port: number } };
    };
    const response = await fetch(`${address.url}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: state.layout,
        fairlight: { host: state.config.fairlight.host, port: state.config.fairlight.port },
        lcd: state.lcd,
        devices: state.devices,
        sendsOnFader: { enabled: false, busIndex: 1 },
        buttonAssignments: {},
        safety: { allowedWriteChannels: [1, 2], allowedWriteBuses: ["main:1"], allowedWriteMonitors: [] },
      }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as { requiresRestart: boolean };
    assert.equal(result.requiresRestart, false);
    assert.equal(savedConfigs, 1);
    assert.equal(existsSync(configPath), true);
    const written = JSON.parse(readFileSync(configPath, "utf8")) as {
      safety: { allowedWriteChannels: number[]; allowedWriteBuses: string[] };
    };
    assert.deepEqual(written.safety.allowedWriteChannels, [1, 2]);
    assert.deepEqual(written.safety.allowedWriteBuses, ["main:1"]);
  });
});
