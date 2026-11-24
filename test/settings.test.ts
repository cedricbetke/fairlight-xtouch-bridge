import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { DEMO_BUSES, DEMO_CHANNELS, DEMO_MONITORS, createDemoConfig } from "../src/settings/demo.js";
import { SettingsServer, type SettingsServerAddress } from "../src/settings/server.js";

const logger = createLogger("error", { sink: () => undefined });

interface DemoEnvironment {
  server: SettingsServer;
  address: SettingsServerAddress;
  directory: string;
  configPath: string;
}

let env: DemoEnvironment;

function layoutFor(order: string[], mainFixed: boolean) {
  const surfaces: Record<string, unknown> = {};
  for (const role of order) {
    surfaces[role] = { mode: role === "main" && mainFixed ? "fixed" : "banking" };
    if (role === "main" && mainFixed) {
      surfaces[role] = {
        mode: "fixed",
        fixedTargets: Array.from({ length: 8 }, (_, index) => ({ kind: "channel", channel: index + 1 })),
      };
    }
  }
  return { order, surfaces };
}

function stripChannels(surface: { strips: Array<{ target: { channel: number | null } | null }> } | undefined) {
  return surface?.strips.map((strip) => strip.target?.channel ?? null);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${env.address.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

before(async () => {
  const directory = mkdtempSync(join(tmpdir(), "ember-settings-"));
  const configPath = join(directory, "bridge.demo.json");
  const server = new SettingsServer({
    configPath,
    config: createDemoConfig(),
    demo: true,
    port: 0,
    logger,
    autoDiscover: false,
  });
  const address = await server.start();
  env = { server, address, directory, configPath };
});

after(async () => {
  await env.server.stop();
  rmSync(env.directory, { recursive: true, force: true });
});

describe("settings server", () => {
  it("serves the page and reports the demo layout", async () => {
    const page = await fetch(`${env.address.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /Einstellungen/);

    const portsResponse = await fetch(`${env.address.url}/api/midi/ports`);
    assert.equal(portsResponse.status, 200);
    const ports = (await portsResponse.json()) as {
      inputs: unknown[];
      outputs: unknown[];
      error: string | null;
    };
    assert.equal(ports.error, null);
    assert.ok(ports.inputs.length >= 3);
    assert.ok(ports.outputs.length >= 3);

    const response = await fetch(`${env.address.url}/api/state`);
    assert.equal(response.status, 200);
    const state = (await response.json()) as {
      demo: boolean;
      channels: unknown[];
      buses: unknown[];
      monitors: unknown[];
      layout: { order: string[] };
      lcd: { colorsEnabled: boolean; line1: string; line2: string };
      preview: {
        bankStep: number;
        bankPages: number;
        surfaces: Array<{
          role: string;
          mode: string;
          strips: Array<{
            target: { channel: number | null } | null;
            lcd: { top: string; bottom: string; color: string; colorEnabled: boolean };
          }>;
        }>;
      };
      midi: { inputs: unknown[]; outputs: unknown[] };
    };
    assert.equal(state.demo, true);
    assert.equal(state.channels.length, DEMO_CHANNELS.length);
    assert.equal(state.buses.length, DEMO_BUSES.length);
    assert.equal(state.monitors.length, DEMO_MONITORS.length);
    assert.deepEqual(state.layout.order, ["main", "extender1", "extender2"]);
    assert.equal(state.lcd.colorsEnabled, true);
    assert.equal(state.lcd.line1, "custom");
    assert.equal(state.lcd.line2, "type-number");
    assert.equal(state.preview.bankStep, 16);
    assert.equal(state.preview.bankPages, 2);
    const main = state.preview.surfaces.find((surface) => surface.role === "main");
    const extender1 = state.preview.surfaces.find((surface) => surface.role === "extender1");
    const extender2 = state.preview.surfaces.find((surface) => surface.role === "extender2");
    assert.equal(main?.mode, "fixed");
    assert.deepEqual(stripChannels(main), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(main?.strips[0]?.lcd, {
      top: "Moderat",
      bottom: "CH 1   ",
      color: "white",
      colorEnabled: true,
      overrideMismatch: false,
    });
    assert.deepEqual(stripChannels(extender1), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(stripChannels(extender2), [17, 18, 19, 20, 21, 22, 23, 24]);
    assert.ok(state.midi.inputs.length >= 3);
    assert.ok(state.midi.outputs.length >= 3);
  });

  it("reorders banking slices with the physical device order", async () => {
    const response = await post("/api/preview", {
      layout: layoutFor(["extender2", "main", "extender1"], false),
      bankOffset: 0,
      enabledRoles: ["main", "extender1", "extender2"],
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()) as {
      surfaces: Array<{ role: string; strips: Array<{ target: { channel: number | null } | null }> }>;
    };
    const extender2 = preview.surfaces.find((surface) => surface.role === "extender2");
    const main = preview.surfaces.find((surface) => surface.role === "main");
    const extender1 = preview.surfaces.find((surface) => surface.role === "extender1");
    assert.deepEqual(stripChannels(extender2), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(stripChannels(main), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(stripChannels(extender1), [17, 18, 19, 20, 21, 22, 23, 24]);
  });

  it("resolves fixed bus targets and keeps them out of banking", async () => {
    const layout = layoutFor(["main", "extender1", "extender2"], true) as {
      order: string[];
      surfaces: Record<string, { mode: string; fixedTargets: Array<Record<string, unknown> | null> }>;
    };
    layout.surfaces["main"]!.fixedTargets[0] = { kind: "bus", busType: "aux", index: 1 };
    const response = await post("/api/preview", {
      layout,
      bankOffset: 0,
      enabledRoles: ["main", "extender1", "extender2"],
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()) as {
      surfaces: Array<{
        role: string;
        strips: Array<{
          target:
            | { kind: "channel" | "bus"; name: string | null; channel: number | null; busType: string | null; index: number | null }
            | null;
        }>;
      }>;
    };
    const main = preview.surfaces.find((surface) => surface.role === "main");
    assert.deepEqual(main?.strips[0]?.target, {
      kind: "bus",
      name: "Kopfhörer",
      channel: null,
      busType: "aux",
      index: 1,
    });
    assert.equal(main?.strips[1]?.target?.channel, 2);
    const extender1 = preview.surfaces.find((surface) => surface.role === "extender1");
    assert.equal(extender1?.strips[0]?.target?.channel, 1);
  });

  it("previews draft LCD colours, lines and overrides", async () => {
    const layout = layoutFor(["main", "extender1", "extender2"], true) as {
      order: string[];
      surfaces: Record<string, { mode: string; fixedTargets: Array<Record<string, unknown> | null> }>;
    };
    layout.surfaces["main"]!.fixedTargets[0] = { kind: "bus", busType: "aux", index: 1 };
    const response = await post("/api/preview", {
      layout,
      bankOffset: 0,
      enabledRoles: ["main", "extender1", "extender2"],
      lcd: {
        colorsEnabled: true,
        line1: "type-number",
        line2: "blank",
        palette: { aux: "magenta" },
        overrides: [
          {
            target: { kind: "bus", busType: "aux", index: 1 },
            color: "green",
            name: "HP",
            expectedName: "Kopfhörer",
          },
          {
            target: { kind: "channel", channel: 2 },
            color: "red",
            name: "G2",
            expectedName: "Alter Name",
          },
        ],
      },
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()) as {
      surfaces: Array<{
        role: string;
        strips: Array<{
          lcd: {
            top: string;
            bottom: string;
            color: string;
            colorEnabled: boolean;
            overrideMismatch: boolean;
          };
        }>;
      }>;
    };
    const main = preview.surfaces.find((surface) => surface.role === "main");
    assert.deepEqual(main?.strips[0]?.lcd, {
      top: "AUX 1  ",
      bottom: "       ",
      color: "green",
      colorEnabled: true,
      overrideMismatch: false,
    });
    assert.deepEqual(main?.strips[1]?.lcd, {
      top: "CH 2   ",
      bottom: "       ",
      color: "white",
      colorEnabled: true,
      overrideMismatch: true,
    });

    const valueResponse = await post("/api/preview", {
      layout,
      bankOffset: 0,
      enabledRoles: ["main", "extender1", "extender2"],
      lcd: { colorsEnabled: true, line1: "type-number", line2: "value" },
    });
    assert.equal(valueResponse.status, 200);
    const valuePreview = (await valueResponse.json()) as {
      surfaces: Array<{ role: string; strips: Array<{ lcd: { bottom: string } }> }>;
    };
    const valueMain = valuePreview.surfaces.find((surface) => surface.role === "main");
    assert.equal(valueMain?.strips[0]?.lcd.bottom, "--     ");
  });

  it("leaves disabled surfaces out of banking", async () => {
    const response = await post("/api/preview", {
      layout: layoutFor(["main", "extender1", "extender2"], false),
      bankOffset: 0,
      enabledRoles: ["main", "extender1"],
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()) as {
      bankStep: number;
      surfaces: Array<{ role: string; strips: Array<{ target: { channel: number | null } | null }> }>;
    };
    assert.equal(preview.bankStep, 16);
    const extender2 = preview.surfaces.find((surface) => surface.role === "extender2");
    assert.deepEqual(stripChannels(extender2), Array(8).fill(null));
  });

  it("blinks the select LEDs on the requested output and records demo MIDI", async () => {
    const response = await post("/api/find", {
      role: "main",
      output: { name: "X-Touch INT", occurrence: 0 },
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as { ok: boolean; output: string };
    assert.equal(result.ok, true);
    assert.equal(result.output, "X-Touch INT");

    const eventsResponse = await fetch(`${env.address.url}/api/demo/midi?since=0`);
    const data = (await eventsResponse.json()) as {
      seq: number;
      events: Array<{ role: string; message: number[] }>;
    };
    assert.ok(data.seq > 0);
    const selectMessages = data.events.filter((event) => {
      const status = event.message[0] ?? 0;
      const note = event.message[1] ?? 0;
      return status === 0x90 && note >= 0x18 && note <= 0x1f;
    });
    assert.ok(selectMessages.length >= 8);
    assert.equal(selectMessages.every((event) => event.role === "main"), true);
    const final = data.events.slice(-8);
    assert.equal(final.every((event) => (event.message[2] ?? -1) === 0), true);
  });

  it("rejects an unknown find output", async () => {
    const response = await post("/api/find", {
      role: "main",
      output: { name: "Missing Port", occurrence: 0 },
    });
    assert.equal(response.status, 400);
  });

  it("rejects foreign origins and non-JSON bodies", async () => {
    const origin = await post(
      "/api/preview",
      { layout: layoutFor(["main", "extender1", "extender2"], false) },
      { Origin: "http://example.com" },
    );
    assert.equal(origin.status, 403);

    const plain = await fetch(`${env.address.url}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.equal(plain.status, 415);
  });

  it("saves a validated layout and device order", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      devices: Array<{ role: string; enabled: boolean; input: unknown; output: unknown }>;
    };
    const layout = layoutFor(["extender1", "extender2", "main"], true) as {
      order: string[];
      surfaces: Record<string, { mode: string; fixedTargets: Array<Record<string, unknown> | null> }>;
    };
    layout.surfaces["main"]!.fixedTargets[7] = { kind: "bus", busType: "mtx", index: 1 };
    const devices = state.devices.map((device) =>
      device.role === "main" ? { ...device, name: "Regie" } : device,
    );
    const response = await post("/api/save", {
      layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices,
    });
    assert.equal(response.status, 200);
    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.deepEqual(saved.mapping.layout?.order, ["extender1", "extender2", "main"]);
    assert.equal(saved.mapping.layout?.surfaces.main!.mode, "fixed");
    assert.deepEqual(saved.mapping.layout?.surfaces.main!.fixedTargets[7], {
      kind: "bus",
      busType: "mtx",
      index: 1,
    });
    assert.equal(saved.mapping.singleChannel, null);
    assert.equal(saved.midi.devices.find((device) => device.role === "main")?.name, "Regie");

    const reloaded = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
    };
    assert.deepEqual(reloaded.layout.order, ["extender1", "extender2", "main"]);
  });

  it("saves LCD settings and preserves them when an older client omits them", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
      devices: Array<Record<string, unknown>>;
    };
    const lcd = {
      colorsEnabled: true,
      line1: "type",
      line2: "number",
      palette: { channel: "cyan", mtx: "off" },
      overrides: [
        {
          target: { kind: "channel", channel: 1 },
          color: "green",
          name: "MOD",
          expectedName: "Moderation",
        },
      ],
    };
    const response = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      lcd,
    });
    assert.equal(response.status, 200);
    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.equal(saved.lcd.line1, "type");
    assert.equal(saved.lcd.line2, "number");
    assert.equal(saved.lcd.palette.channel, "cyan");
    assert.equal(saved.lcd.palette.mtx, "off");
    assert.deepEqual(saved.lcd.overrides[0], {
      target: { kind: "channel", channel: 1 },
      color: "green",
      name: "MOD",
      expectedName: "Moderation",
    });

    const legacy = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
    });
    assert.equal(legacy.status, 200);
    const preserved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.equal(preserved.lcd.line1, "type");
    assert.equal(preserved.lcd.overrides.length, 1);
  });

  it("saves the sends-on-fader aux and preserves it when an older client omits it", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
      devices: Array<Record<string, unknown>>;
    };
    const response = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      sendsOnFader: { enabled: true, busIndex: 2 },
      buttonAssignments: {
        f1: { type: "sends-on-fader", auxIndex: 1 },
        f2: { type: "sends-on-fader", auxIndex: 2 },
      },
    });
    assert.equal(response.status, 200);
    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.deepEqual(saved.mapping.sendsOnFader, { enabled: true, busIndex: 2 });
    assert.deepEqual(saved.mapping.buttonAssignments, {
      f1: { type: "sends-on-fader", auxIndex: 1 },
      f2: { type: "sends-on-fader", auxIndex: 2 },
    });

    const legacy = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
    });
    assert.equal(legacy.status, 200);
    const preserved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.deepEqual(preserved.mapping.sendsOnFader, { enabled: true, busIndex: 2 });
    assert.deepEqual(preserved.mapping.buttonAssignments, {
      f1: { type: "sends-on-fader", auxIndex: 1 },
      f2: { type: "sends-on-fader", auxIndex: 2 },
    });

    const invalid = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      sendsOnFader: { enabled: true, busIndex: 0 },
    });
    assert.equal(invalid.status, 400);

    const invalidAssignment = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      buttonAssignments: { f9: { type: "sends-on-fader", auxIndex: 1 } },
    });
    assert.equal(invalidAssignment.status, 400);
  });

  it("saves monitor-dim assignments and rejects unknown monitor numbers", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
      devices: Array<Record<string, unknown>>;
    };
    const response = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      buttonAssignments: {
        f3: { type: "monitor-dim", monitorIndex: 2 },
      },
    });
    assert.equal(response.status, 200);
    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.deepEqual(saved.mapping.buttonAssignments, {
      f3: { type: "monitor-dim", monitorIndex: 2 },
    });
    assert.deepEqual(saved.safety.allowedWriteMonitors, [1, 2, 3, 4]);

    const invalid = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 5 } },
    });
    assert.equal(invalid.status, 400);
  });

  it("saves assignments on the right-hand X-Touch keys", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
      devices: Array<Record<string, unknown>>;
    };
    const response = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      buttonAssignments: {
        play: { type: "sends-on-fader", auxIndex: 2 },
        marker: { type: "monitor-dim", monitorIndex: 1 },
      },
    });
    assert.equal(response.status, 200);
    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    assert.deepEqual(saved.mapping.buttonAssignments, {
      play: { type: "sends-on-fader", auxIndex: 2 },
      marker: { type: "monitor-dim", monitorIndex: 1 },
    });

    const reserved = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      buttonAssignments: { "bank-left": { type: "sends-on-fader", auxIndex: 1 } },
    });
    assert.equal(reserved.status, 400);
  });

  it("rejects invalid LCD settings on save", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      layout: { order: string[] };
      devices: Array<Record<string, unknown>>;
    };
    const response = await post("/api/save", {
      layout: state.layout,
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices: state.devices,
      lcd: { palette: { channel: "orange" } },
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /lcd\.palette\.channel/);
  });

  it("saves a network draft and simulates find and connection tests in the demo", async () => {
    const state = (await (await fetch(`${env.address.url}/api/state`)).json()) as {
      devices: Array<Record<string, unknown>>;
    };
    const devices = state.devices.map((device) =>
      device["role"] === "main"
        ? { ...device, transport: "network", network: { host: "192.168.1.29", port: 5004 } }
        : device,
    );
    const response = await post("/api/save", {
      layout: layoutFor(["main", "extender1", "extender2"], false),
      fairlight: { host: "127.0.0.1", port: 9000 },
      devices,
    });
    assert.equal(response.status, 200);

    const saved = parseConfig(JSON.parse(readFileSync(env.configPath, "utf8")) as unknown);
    const main = saved.midi.devices.find((device) => device.role === "main");
    assert.equal(main?.transport, "network");
    assert.deepEqual(main?.network, { host: "192.168.1.29", port: 5004 });

    const testResponse = await post("/api/network/test", {
      role: "main",
      host: "192.168.1.29",
      port: 5004,
    });
    assert.equal(testResponse.status, 200);
    const testResult = (await testResponse.json()) as { ok: boolean; simulated: boolean };
    assert.equal(testResult.ok, true);
    assert.equal(testResult.simulated, true);

    const invalidTest = await post("/api/network/test", { role: "main", host: "", port: 5004 });
    assert.equal(invalidTest.status, 400);

    const before = (await (await fetch(`${env.address.url}/api/demo/midi?since=0`)).json()) as { seq: number };
    const findResponse = await post("/api/find", { role: "main" });
    assert.equal(findResponse.status, 200);
    const findResult = (await findResponse.json()) as {
      ok: boolean;
      simulated: boolean;
      transport: string;
    };
    assert.equal(findResult.ok, true);
    assert.equal(findResult.simulated, true);
    assert.equal(findResult.transport, "network");

    const events = (await (
      await fetch(`${env.address.url}/api/demo/midi?since=${before.seq}`)
    ).json()) as { events: Array<{ role: string; message: number[] }> };
    assert.ok(events.events.length >= 8);
    assert.equal(events.events.every((event) => event.role === "main"), true);
  });
});

describe("settings server dynamic surfaces", () => {
  it("saves an additional surface and keeps encoder and meter options", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ember-settings-dynamic-"));
    const configPath = join(directory, "bridge.demo.json");
    const server = new SettingsServer({
      configPath,
      config: createDemoConfig(),
      demo: true,
      port: 0,
      logger,
      autoDiscover: false,
    });
    const address = await server.start();
    try {
      const state = (await (await fetch(`${address.url}/api/state`)).json()) as {
        devices: Array<Record<string, unknown>>;
      };
      const devices = state.devices.map((device) => ({
        role: device["role"],
        kind: device["kind"],
        name: device["name"],
        enabled: device["enabled"],
        transport: device["transport"],
        input: device["input"],
        output: device["output"],
        network: device["network"],
        encoder: device["encoder"],
        meters: device["meters"],
      }));
      devices.push({
        role: "extender3",
        kind: "extender",
        name: null,
        enabled: true,
        transport: "usb",
        input: { name: "X-Touch Extender", occurrence: 2 },
        output: { name: "X-Touch Extender", occurrence: 2 },
        network: null,
        encoder: "pan",
        meters: true,
      });
      const layout = {
        order: ["main", "extender1", "extender2", "extender3"],
        surfaces: {
          main: { mode: "banking", fixedTargets: [] },
          extender1: { mode: "banking", fixedTargets: [] },
          extender2: { mode: "banking", fixedTargets: [] },
          extender3: { mode: "banking", fixedTargets: [] },
        },
      };
      const response = await fetch(`${address.url}/api/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, devices }),
      });
      assert.equal(response.status, 200);
      const saved = parseConfig(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
      assert.equal(saved.midi.devices.length, 4);
      const added = saved.midi.devices.find((device) => device.role === "extender3");
      assert.equal(added?.kind, "extender");
      assert.equal(added?.encoder, "pan");
      assert.equal(added?.meters, true);
      assert.deepEqual(saved.mapping.layout?.order, [
        "main",
        "extender1",
        "extender2",
        "extender3",
      ]);

      const refreshed = (await (await fetch(`${address.url}/api/state`)).json()) as {
        roleLabels: Record<string, string>;
      };
      assert.equal(refreshed.roleLabels["extender3"], "Extender 3");
    } finally {
      await server.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
