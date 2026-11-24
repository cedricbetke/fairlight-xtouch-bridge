import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { DEFAULT_CONFIG, configuredAuxTargets, configuredMonitorTargets, parseConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

function minimal(overrides: Record<string, unknown> = {}) {
  return {
    midi: {
      devices: [
        {
          role: "main",
          input: { name: "X-Touch", occurrence: 0 },
          output: { name: "X-Touch", occurrence: 0 },
        },
      ],
    },
    ...overrides,
  };
}

describe("configuration", () => {
  it("applies documented defaults", () => {
    const config = parseConfig(minimal());
    assert.equal(config.fairlight.host, "127.0.0.1");
    assert.equal(config.fairlight.port, 9000);
    assert.equal(config.mapping.bankStep, 24);
    assert.equal(config.mapping.singleChannel, null);
    assert.equal(config.mapping.singleChannelName, null);
    assert.equal(config.mapping.master.enabled, false);
    assert.deepEqual(config.mapping.sendsOnFader, { enabled: false, busIndex: 1 });
    assert.deepEqual(config.safety.allowedWriteChannels, []);
    assert.equal(config.safety.requireTouchForWrites, true);
    assert.equal(config.safety.alignMotorsOnStart, true);
    assert.equal(config.safety.alignMotorsOnBankChange, true);
    assert.equal(config.safety.writeExpiryMs, 250);
    assert.equal(config.logLevel, "info");
  });

  it("parses startup and bank motor alignment", () => {
    const config = parseConfig(
      minimal({ safety: { alignMotorsOnStart: false, alignMotorsOnBankChange: false } }),
    );
    assert.equal(config.safety.alignMotorsOnStart, false);
    assert.equal(config.safety.alignMotorsOnBankChange, false);
  });

  it("parses a sends-on-fader aux target", () => {
    const config = parseConfig(minimal({ mapping: { sendsOnFader: { enabled: true, busIndex: 3 } } }));
    assert.deepEqual(config.mapping.sendsOnFader, { enabled: true, busIndex: 3 });
    assert.throws(
      () => parseConfig(minimal({ mapping: { sendsOnFader: { enabled: true, busIndex: 0 } } })),
      ConfigError,
    );
  });

  it("parses function button assignments", () => {
    const config = parseConfig(
      minimal({
        mapping: {
          sendsOnFader: { enabled: true, busIndex: 1 },
          buttonAssignments: {
            f1: { type: "sends-on-fader", auxIndex: 1 },
            f2: { type: "sends-on-fader", auxIndex: 2 },
          },
        },
      }),
    );
    assert.deepEqual(config.mapping.buttonAssignments, {
      f1: { type: "sends-on-fader", auxIndex: 1 },
      f2: { type: "sends-on-fader", auxIndex: 2 },
    });
    assert.deepEqual(configuredAuxTargets(config.mapping), [1, 2]);
    assert.throws(
      () => parseConfig(minimal({ mapping: { buttonAssignments: { f9: { type: "sends-on-fader", auxIndex: 1 } } } })),
      ConfigError,
    );
    assert.throws(
      () => parseConfig(minimal({ mapping: { buttonAssignments: { f1: { type: "shortcut" } } } })),
      ConfigError,
    );
    assert.throws(
      () => parseConfig(minimal({ mapping: { buttonAssignments: { f1: { type: "sends-on-fader", auxIndex: 0 } } } })),
      ConfigError,
    );
  });

  it("parses monitor-dim function button assignments and write allowlists", () => {
    const config = parseConfig(
      minimal({
        mapping: {
          buttonAssignments: {
            f3: { type: "monitor-dim", monitorIndex: 2 },
          },
        },
        safety: { allowedWriteMonitors: [2, 2, 4] },
      }),
    );
    assert.deepEqual(config.mapping.buttonAssignments, {
      f3: { type: "monitor-dim", monitorIndex: 2 },
    });
    assert.deepEqual(configuredMonitorTargets(config.mapping), [2]);
    assert.deepEqual(config.safety.allowedWriteMonitors, [2, 4]);
    assert.deepEqual(configuredAuxTargets(config.mapping), []);
    assert.throws(
      () => parseConfig(minimal({ mapping: { buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 0 } } } })),
      ConfigError,
    );
    assert.throws(
      () => parseConfig(minimal({ mapping: { buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 5 } } } })),
      ConfigError,
    );
  });

  it("accepts the right-hand X-Touch keys and rejects reserved ones", () => {
    const config = parseConfig(
      minimal({
        mapping: {
          buttonAssignments: {
            play: { type: "sends-on-fader", auxIndex: 2 },
            marker: { type: "monitor-dim", monitorIndex: 1 },
          },
        },
      }),
    );
    assert.deepEqual(config.mapping.buttonAssignments, {
      play: { type: "sends-on-fader", auxIndex: 2 },
      marker: { type: "monitor-dim", monitorIndex: 1 },
    });
    assert.deepEqual(configuredAuxTargets(config.mapping), [2]);
    assert.deepEqual(configuredMonitorTargets(config.mapping), [1]);
    for (const reserved of ["bank-left", "bank-right", "send", "pan", "flip", "channel-left"]) {
      assert.throws(
        () =>
          parseConfig(
            minimal({
              mapping: { buttonAssignments: { [reserved]: { type: "sends-on-fader", auxIndex: 1 } } },
            }),
          ),
        ConfigError,
      );
    }
  });

  it("normalises short port selectors", () => {
    const config = parseConfig(
      minimal({
        midi: {
          devices: [{ role: "main", input: "X-Touch", output: "X-Touch" }],
        },
      }),
    );
    assert.deepEqual(config.midi.devices[0]?.input, { name: "X-Touch", occurrence: 0 });
  });

  it("defaults to the USB transport", () => {
    const config = parseConfig(minimal());
    assert.equal(config.midi.devices[0]?.transport, "usb");
    assert.equal(config.midi.devices[0]?.network, null);
  });

  it("parses an optional custom device name", () => {
    const config = parseConfig(
      minimal({
        midi: {
          devices: [
            {
              role: "main",
              name: "  Regie  ",
              input: "X-Touch",
              output: "X-Touch",
            },
            {
              role: "extender1",
              name: "   ",
              input: "Extender",
              output: "Extender",
            },
          ],
        },
      }),
    );
    assert.equal(config.midi.devices[0]?.name, "Regie");
    assert.equal(config.midi.devices[1]?.name, null);
  });

  it("rejects a device name longer than 40 characters", () => {
    assert.throws(
      () =>
        parseConfig(
          minimal({
            midi: {
              devices: [
                {
                  role: "main",
                  name: "x".repeat(41),
                  input: "X-Touch",
                  output: "X-Touch",
                },
              ],
            },
          }),
        ),
      /at most 40 characters/,
    );
  });

  it("parses a network transport with default and custom RTP-MIDI port", () => {
    const config = parseConfig(
      minimal({
        midi: {
          devices: [
            {
              role: "main",
              transport: "network",
              input: { name: "X-Touch", occurrence: 0 },
              output: { name: "X-Touch", occurrence: 0 },
              network: { host: "192.168.1.29" },
            },
            {
              role: "extender1",
              transport: "network",
              input: { name: "Extender", occurrence: 0 },
              output: { name: "Extender", occurrence: 0 },
              network: { host: "192.168.1.30", port: 5010 },
            },
          ],
        },
      }),
    );
    assert.deepEqual(config.midi.devices[0]?.network, { host: "192.168.1.29", port: 5004 });
    assert.deepEqual(config.midi.devices[1]?.network, { host: "192.168.1.30", port: 5010 });
  });

  it("rejects network devices without a host", () => {
    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [
              {
                role: "main",
                transport: "network",
                input: "X-Touch",
                output: "X-Touch",
              },
            ],
          },
        }),
      /network\.host is required/,
    );
  });

  it("rejects an unknown transport", () => {
    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [{ role: "main", transport: "wifi", input: "X-Touch", output: "X-Touch" }],
          },
        }),
      /transport must be one of/,
    );
  });

  it("rejects duplicate network endpoints", () => {
    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [
              {
                role: "main",
                transport: "network",
                input: "X-Touch",
                output: "X-Touch",
                network: { host: "192.168.1.29", port: 5004 },
              },
              {
                role: "extender1",
                transport: "network",
                input: "Extender",
                output: "Extender",
                network: { host: "192.168.1.29", port: 5004 },
              },
            ],
          },
        }),
      /assigned to both/,
    );
  });

  it("allows the same MIDI port on a USB and a network device", () => {
    const config = parseConfig({
      midi: {
        devices: [
          {
            role: "main",
            transport: "network",
            input: { name: "X-Touch", occurrence: 0 },
            output: { name: "X-Touch", occurrence: 0 },
            network: { host: "192.168.1.29" },
          },
          {
            role: "extender1",
            input: { name: "X-Touch", occurrence: 0 },
            output: { name: "X-Touch", occurrence: 0 },
          },
        ],
      },
    });
    assert.equal(config.midi.devices.length, 2);
  });

  it("rejects duplicate roles", () => {    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [
              { role: "main", input: "a", output: "a" },
              { role: "main", input: "b", output: "b" },
            ],
          },
        }),
      ConfigError,
    );
  });

  it("rejects duplicate input or output assignments", () => {
    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [
              { role: "main", input: "X-Touch", output: "X-Touch" },
              { role: "extender1", input: "X-Touch", output: "Extender" },
            ],
          },
        }),
      /assigned to both/,
    );
    assert.throws(
      () =>
        parseConfig({
          midi: {
            devices: [
              { role: "main", input: { name: "X-Touch", occurrence: 0 }, output: { name: "X-Touch", occurrence: 0 } },
              { role: "extender1", input: { name: "Extender", occurrence: 0 }, output: { name: "X-Touch", occurrence: 0 } },
            ],
          },
        }),
      /assigned to both/,
    );
    const config = parseConfig({
      midi: {
        devices: [
          { role: "extender1", input: { name: "Extender", occurrence: 0 }, output: { name: "Extender", occurrence: 0 } },
          { role: "extender2", input: { name: "Extender", occurrence: 1 }, output: { name: "Extender", occurrence: 1 } },
        ],
      },
    });
    assert.equal(config.midi.devices.length, 2);
  });

  it("deduplicates and sorts write allowlists", () => {
    const config = parseConfig(
      minimal({
        safety: {
          allowedWriteChannels: [3, 1, 3],
          allowedWriteBuses: ["main:1", "main:1", "aux:2"],
        },
      }),
    );
    assert.deepEqual(config.safety.allowedWriteChannels, [1, 3]);
    assert.deepEqual(config.safety.allowedWriteBuses, ["main:1", "aux:2"]);
  });

  it("requires both MIDI ports for every device", () => {
    assert.throws(
      () => parseConfig({ midi: { devices: [{ role: "main", output: "X-Touch" }] } }),
      /input is required/,
    );
    assert.throws(
      () => parseConfig({ midi: { devices: [{ role: "main", input: "X-Touch" }] } }),
      /output is required/,
    );
  });

  it("rejects invalid ports, ranges and bus types", () => {
    assert.throws(() => parseConfig(minimal({ fairlight: { port: 0 } })), ConfigError);
    assert.throws(() => parseConfig(minimal({ fairlight: { port: 70000 } })), ConfigError);
    assert.throws(() => parseConfig(minimal({ mapping: { master: { busType: "monitor" } } })), ConfigError);
    assert.throws(() => parseConfig(minimal({ safety: { maxWritesPerSecond: 0 } })), ConfigError);
    assert.throws(() => parseConfig(minimal({ safety: { writeExpiryMs: 0 } })), ConfigError);
    assert.throws(
      () => parseConfig(minimal({ mapping: { singleChannelName: "MIC" } })),
      /requires mapping.singleChannel/,
    );
    assert.throws(() => parseConfig(minimal({ logLevel: "verbose" })), ConfigError);
  });

  it("accepts a surface layout with channels, buses and banking devices", () => {
    const config = parseConfig(
      minimal({
        mapping: {
          layout: {
            order: ["extender1", "main", "extender2"],
            surfaces: {
              main: {
                mode: "fixed",
                fixedTargets: [
                  { kind: "channel", channel: 1 },
                  { kind: "channel", channel: 2 },
                  null,
                  { kind: "bus", busType: "aux", index: 1 },
                ],
              },
              extender1: { mode: "banking" },
            },
          },
        },
      }),
    );
    assert.deepEqual(config.mapping.layout?.order, ["extender1", "main", "extender2"]);
    assert.equal(config.mapping.layout?.surfaces.main!.mode, "fixed");
    assert.deepEqual(config.mapping.layout?.surfaces.main!.fixedTargets, [
      { kind: "channel", channel: 1 },
      { kind: "channel", channel: 2 },
      null,
      { kind: "bus", busType: "aux", index: 1 },
      null,
      null,
      null,
      null,
    ]);
    assert.equal(config.mapping.layout?.surfaces.extender1!.mode, "banking");
    assert.deepEqual(config.mapping.layout?.surfaces.extender2!.fixedTargets, []);
  });

  it("loads legacy fixedChannels layouts as channel targets", () => {
    const config = parseConfig(
      minimal({
        mapping: {
          layout: {
            order: ["main", "extender1", "extender2"],
            surfaces: { main: { mode: "fixed", fixedChannels: [3, 7] } },
          },
        },
      }),
    );
    assert.deepEqual(config.mapping.layout?.surfaces.main!.fixedTargets, [
      { kind: "channel", channel: 3 },
      { kind: "channel", channel: 7 },
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("defaults the layout to off", () => {
    const config = parseConfig(minimal());
    assert.equal(config.mapping.layout, null);
  });

  it("rejects invalid layout order, modes and duplicate fixed channels", () => {
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: { layout: { order: ["main", "extender1", "extender1"], surfaces: {} } },
          }),
        ),
      /more than once/,
    );
    const twoSurfaces = parseConfig(
      minimal({
        mapping: { layout: { order: ["main", "extender1"], surfaces: {} } },
      }),
    );
    assert.deepEqual(twoSurfaces.mapping.layout?.order, ["main", "extender1"]);
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: { layout: { order: [], surfaces: {} } },
          }),
        ),
      /at least one surface/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: {
              layout: {
                order: ["main", "extender1", "extender2"],
                surfaces: { main: { mode: "follow" } },
              },
            },
          }),
        ),
      /mode must be one of/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: {
              layout: {
                order: ["main", "extender1", "extender2"],
                surfaces: {
                  main: { mode: "fixed", fixedChannels: [1] },
                  extender1: { mode: "fixed", fixedChannels: [1] },
                },
              },
            },
          }),
        ),
      /assigns channel 1 more than once/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: {
              layout: {
                order: ["main", "extender1", "extender2"],
                surfaces: {
                  main: { mode: "fixed", fixedTargets: [{ kind: "bus", busType: "aux", index: 1 }] },
                  extender1: { mode: "fixed", fixedTargets: [{ kind: "bus", busType: "aux", index: 1 }] },
                },
              },
            },
          }),
        ),
      /assigns bus aux:1 more than once/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: {
              layout: {
                order: ["main", "extender1", "extender2"],
                surfaces: {
                  main: {
                    mode: "fixed",
                    fixedChannels: [1],
                    fixedTargets: [{ kind: "channel", channel: 2 }],
                  },
                },
              },
            },
          }),
        ),
      /either fixedTargets or fixedChannels/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            mapping: {
              layout: {
                order: ["main", "extender1", "extender2"],
                surfaces: { main: { mode: "fixed", fixedChannels: [0] } },
              },
            },
          }),
        ),
      /positive channel number or null/,
    );
  });

  it("parses LCD colours, line modes and overrides", () => {
    const config = parseConfig(
      minimal({
        lcd: {
          colorsEnabled: false,
          line1: "type",
          line2: "blank",
          palette: { channel: "green", aux: "off", vca: "magenta" },
          overrides: [
            {
              target: { kind: "channel", channel: 3 },
              color: "magenta",
              name: "MOD",
              expectedName: "Moderation",
            },
            { target: { kind: "bus", busType: "aux", index: 2 }, color: "auto" },
          ],
        },
      }),
    );
    assert.equal(config.lcd.colorsEnabled, false);
    assert.equal(config.lcd.line1, "type");
    assert.equal(config.lcd.line2, "blank");
    assert.equal(config.lcd.palette.channel, "green");
    assert.equal(config.lcd.palette.aux, "off");
    assert.equal(config.lcd.palette.vca, "magenta");
    assert.equal(config.lcd.palette.main, "red");
    assert.deepEqual(config.lcd.overrides[0], {
      target: { kind: "channel", channel: 3 },
      color: "magenta",
      name: "MOD",
      expectedName: "Moderation",
    });
    assert.deepEqual(config.lcd.overrides[1], {
      target: { kind: "bus", busType: "aux", index: 2 },
      color: "auto",
      name: null,
      expectedName: null,
    });
  });

  it("defaults the LCD to type colours and the previous text layout", () => {
    const config = parseConfig(minimal());
    assert.deepEqual(config.lcd, DEFAULT_CONFIG.lcd);
    assert.equal(config.lcd.colorsEnabled, true);
    assert.equal(config.lcd.line1, "custom");
    assert.equal(config.lcd.line2, "type-number");
    assert.deepEqual(config.lcd.palette, {
      channel: "white",
      main: "red",
      sub: "blue",
      aux: "cyan",
      mixm: "magenta",
      mtx: "yellow",
      vca: "green",
    });
    assert.deepEqual(config.lcd.overrides, []);
  });

  it("accepts the runtime LCD line modes", () => {
    const config = parseConfig(minimal({ lcd: { line1: "value", line2: "target" } }));
    assert.equal(config.lcd.line1, "value");
    assert.equal(config.lcd.line2, "target");
  });

  it("rejects invalid LCD colours, line modes, names and duplicate overrides", () => {
    assert.throws(() => parseConfig(minimal({ lcd: { palette: { channel: "orange" } } })), /lcd\.palette\.channel/);
    assert.throws(() => parseConfig(minimal({ lcd: { line1: "scroll" } })), /lcd\.line1/);
    assert.throws(
      () =>
        parseConfig(
          minimal({
            lcd: {
              overrides: [
                { target: { kind: "channel", channel: 1 }, color: "red", name: "TOOLONG1" },
              ],
            },
          }),
        ),
      /at most 7 characters/,
    );
    assert.throws(
      () =>
        parseConfig(
          minimal({
            lcd: {
              overrides: [
                { target: { kind: "channel", channel: 1 }, color: "red" },
                { target: { kind: "channel", channel: 1 }, color: "blue" },
              ],
            },
          }),
        ),
      /more than once/,
    );
    assert.throws(
      () => parseConfig(minimal({ lcd: { overrides: [{ target: { kind: "bus", busType: "dca", index: 1 } }] } })),
      /busType must be one of/,
    );
  });

  it("exposes an unchanged default object for read-only discovery", () => {
    assert.equal(DEFAULT_CONFIG.fairlight.port, 9000);
    assert.deepEqual(DEFAULT_CONFIG.midi.devices, []);
  });

  it("parses per-device encoder and meter options", () => {
    const config = parseConfig(
      minimal({
        midi: {
          devices: [
            { role: "main", input: "a", output: "a", encoder: "pan", meters: true },
            { role: "extender1", input: "b", output: "b" },
          ],
        },
      }),
    );
    assert.equal(config.midi.devices[0]?.encoder, "pan");
    assert.equal(config.midi.devices[0]?.meters, true);
    assert.equal(config.midi.devices[0]?.kind, "main");
    assert.equal(config.midi.devices[1]?.encoder, "off");
    assert.equal(config.midi.devices[1]?.meters, false);
    assert.equal(config.midi.devices[1]?.kind, "extender");
    assert.throws(
      () =>
        parseConfig(
          minimal({ midi: { devices: [{ role: "main", input: "a", output: "a", encoder: "eq" }] } }),
        ),
      /encoder must be one of/,
    );
  });

  it("accepts more than three surfaces and rejects duplicate main devices or malformed roles", () => {
    const config = parseConfig(
      minimal({
        midi: {
          devices: [
            { role: "main", kind: "main", input: "a", output: "a" },
            { role: "extender1", input: "b", output: "b" },
            { role: "extender2", input: "c", output: "c" },
            { role: "extender3", input: "d", output: "d" },
          ],
        },
        mapping: {
          layout: {
            order: ["main", "extender1", "extender2", "extender3"],
            surfaces: {
              main: { mode: "fixed", fixedTargets: [{ kind: "channel", channel: 1 }] },
              extender1: { mode: "banking" },
              extender2: { mode: "banking" },
              extender3: { mode: "banking" },
            },
          },
        },
      }),
    );
    assert.equal(config.midi.devices.length, 4);
    assert.deepEqual(config.mapping.layout?.order, ["main", "extender1", "extender2", "extender3"]);
    assert.throws(
      () =>
        parseConfig(
          minimal({
            midi: {
              devices: [
                { role: "main", kind: "main", input: "a", output: "a" },
                { role: "spare", kind: "main", input: "b", output: "b" },
              ],
            },
          }),
        ),
      /at most one main surface/,
    );
    assert.throws(
      () => parseConfig(minimal({ midi: { devices: [{ role: "Bad Role", input: "a", output: "a" }] } })),
      /lowercase identifier/,
    );
  });
});
