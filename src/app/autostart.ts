import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AutostartController {
  readonly supported: boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void> | void;
}

export const AUTOSTART_ENTRY_NAME = "fairlight-xtouch-bridge.desktop";

/**
 * Quote one Exec argument according to the freedesktop Desktop Entry spec.
 * Reserved characters and spaces force quotes; `%` is always a field code and
 * therefore doubled.
 */
export function desktopExecArgument(value: string): string {
  const escapedPercent = value.replaceAll("%", "%%");
  if (!/[\s"'\\><~|&;$*?#()`]/.test(value)) return escapedPercent;
  return `"${escapedPercent.replace(/(["`$\\])/g, "\\$1")}"`;
}

export function linuxDesktopEntry(execPath: string, args: readonly string[] = []): string {
  const command = [execPath, ...args].map(desktopExecArgument).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Fairlight X-Touch Bridge",
    "Comment=Control bridge between Behringer X-Touch and Fairlight Live",
    `Exec=${command}`,
    "Terminal=false",
    "StartupNotify=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export interface LinuxAutostartOptions {
  execPath: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * XDG Autostart for Linux desktops, where Electron has no login item API.
 */
export class LinuxAutostart implements AutostartController {
  readonly supported = true;
  readonly #entryPath: string;
  readonly #execPath: string;
  readonly #args: readonly string[];

  constructor(options: LinuxAutostartOptions) {
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    const configHome = env["XDG_CONFIG_HOME"] ?? join(home, ".config");
    this.#entryPath = join(configHome, "autostart", AUTOSTART_ENTRY_NAME);
    this.#execPath = options.execPath;
    this.#args = options.args ?? [];
  }

  get entryPath(): string {
    return this.#entryPath;
  }

  isEnabled(): boolean {
    return existsSync(this.#entryPath);
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) {
      rmSync(this.#entryPath, { force: true });
      return;
    }
    mkdirSync(dirname(this.#entryPath), { recursive: true });
    writeFileSync(this.#entryPath, linuxDesktopEntry(this.#execPath, this.#args), "utf8");
  }
}

/**
 * For tests and platforms without an autostart mechanism.
 */
export class NoopAutostart implements AutostartController {
  readonly supported = false;
  isEnabled(): boolean {
    return false;
  }
  setEnabled(): void {
    // Nothing to do.
  }
}
