import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { BridgeError } from "../errors.js";

export interface AppSettings {
  autostart: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autostart: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Small preferences file for the desktop app. It is deliberately separate from
 * the bridge configuration: the settings page can rewrite bridge.json without
 * touching the app preferences, and a broken preferences file cannot prevent
 * the bridge from starting.
 */
export class AppSettingsStore {
  readonly #path: string;
  #settings: AppSettings;

  constructor(path: string) {
    this.#path = path;
    this.#settings = { ...DEFAULT_APP_SETTINGS, ...this.#read() };
  }

  get path(): string {
    return this.#path;
  }

  get(): AppSettings {
    return { ...this.#settings };
  }

  setAutostart(enabled: boolean): AppSettings {
    const next: AppSettings = { ...this.#settings, autostart: enabled };
    this.#write(next);
    this.#settings = next;
    return this.get();
  }

  #read(): Partial<AppSettings> {
    if (!existsSync(this.#path)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch {
      return {};
    }
    if (!isRecord(parsed)) return {};
    return {
      autostart: typeof parsed["autostart"] === "boolean" ? parsed["autostart"] : DEFAULT_APP_SETTINGS.autostart,
    };
  }

  #write(settings: AppSettings): void {
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.${basename(this.#path)}.${process.pid}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      renameSync(temporary, this.#path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new BridgeError(
        "APP_SETTINGS_SAVE_FAILED",
        `App-Einstellungen konnten nicht geschrieben werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
