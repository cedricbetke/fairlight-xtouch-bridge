import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIRECTORY_NAME = "Fairlight X-Touch Bridge";
const LINUX_DIRECTORY_NAME = "fairlight-xtouch-bridge";

export interface DataDirOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * Directory for the app's configuration, settings and logs.
 *
 * FAIRLIGHT_BRIDGE_DATA_DIR overrides the platform default, which keeps the
 * desktop app's data separate from a source checkout and makes tests easy.
 */
export function defaultDataDir(options: DataDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const override = env["FAIRLIGHT_BRIDGE_DATA_DIR"];
  if (override && override.trim() !== "") return override;

  if (platform === "win32") {
    const appData = env["APPDATA"] ?? join(home, "AppData", "Roaming");
    return join(appData, APP_DIRECTORY_NAME);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_DIRECTORY_NAME);
  }
  const configHome = env["XDG_CONFIG_HOME"] ?? join(home, ".config");
  return join(configHome, LINUX_DIRECTORY_NAME);
}

export function configFilePath(dataDir: string): string {
  return join(dataDir, "bridge.json");
}

export function appSettingsFilePath(dataDir: string): string {
  return join(dataDir, "app.json");
}

export function logFilePath(dataDir: string): string {
  return join(dataDir, "logs", "bridge.log");
}
