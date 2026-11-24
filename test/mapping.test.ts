import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { DEFAULT_CONFIG, defaultLayout, type LayoutConfig, type SurfaceRole } from "../src/config.js";
import { ChannelMap } from "../src/mapping/channelMap.js";

function mappingConfig(overrides: Partial<(typeof DEFAULT_CONFIG)["mapping"]> = {}) {
  return {
    ...DEFAULT_CONFIG.mapping,
    ...overrides,
    master: { ...DEFAULT_CONFIG.mapping.master, ...(overrides.master ?? {}) },
  };
}

function layoutConfig(options: {
  order?: SurfaceRole[];
  fixed?: Partial<Record<SurfaceRole, Array<number | null>>>;
} = {}): LayoutConfig {
  const layout = defaultLayout();
  if (options.order) layout.order = [...options.order];
  for (const role of layout.order) {
    const channels = options.fixed?.[role];
    if (channels) {
      layout.surfaces[role] = {
        mode: "fixed",
        fixedTargets: channels.map((channel) =>
          channel === null ? null : { kind: "channel" as const, channel },
        ),
      };
    }
  }
  return layout;
}

describe("channel mapping", () => {
  it("maps 24 channels across the three surfaces without overlap", () => {
    const map = new ChannelMap(mappingConfig());
    map.setChannelCount(24);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 1 });
    assert.deepEqual(map.resolve("main", 7), { kind: "channel", channel: 8 });
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 9 });
    assert.deepEqual(map.resolve("extender1", 7), { kind: "channel", channel: 16 });
    assert.deepEqual(map.resolve("extender2", 0), { kind: "channel", channel: 17 });
    assert.deepEqual(map.resolve("extender2", 7), { kind: "channel", channel: 24 });
    assert.equal(map.resolve("main", 8), null);
    const targets = map.bindings().map((binding) => `${binding.role}:${binding.strip}:${JSON.stringify(binding.target)}`);
    assert.equal(new Set(targets).size, 24);
  });

  it("banks all surfaces together in 24-channel steps", () => {
    const map = new ChannelMap(mappingConfig({ bankStep: 24 }));
    map.setChannelCount(60);
    assert.equal(map.bank("right"), true);
    assert.equal(map.bankOffset, 24);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 25 });
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 33 });
    assert.deepEqual(map.resolve("extender2", 7), { kind: "channel", channel: 48 });
    assert.equal(map.bank("right"), true);
    assert.equal(map.bankOffset, 48);
    assert.equal(map.resolve("main", 0)?.kind, "channel");
    assert.equal(map.bank("right"), false);
    assert.equal(map.bankOffset, 48);
    assert.equal(map.bank("left"), true);
    assert.equal(map.bankOffset, 24);
  });

  it("does not bank beyond the available channels", () => {
    const map = new ChannelMap(mappingConfig({ bankStep: 24 }));
    map.setChannelCount(24);
    assert.equal(map.bank("right"), false);
    assert.equal(map.bankOffset, 0);
    map.setChannelCount(30);
    map.bank("right");
    assert.equal(map.bankOffset, 24);
    assert.equal(map.resolve("main", 6), null);
  });

  it("binds a single PoC channel only to main strip 1", () => {
    const map = new ChannelMap(mappingConfig({ singleChannel: 7 }));
    map.setChannelCount(24);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 7 });
    assert.equal(map.resolve("main", 1), null);
    assert.equal(map.resolve("extender1", 0), null);
    assert.equal(map.bindings().length, 1);
  });

  it("binds the main fader to a configured bus", () => {
    const map = new ChannelMap(
      mappingConfig({
        master: { enabled: true, busType: "aux", busIndex: 3 },
      }),
    );
    map.setChannelCount(24);
    assert.deepEqual(map.resolve("main", 8), { kind: "bus", busType: "aux", index: 3 });
    assert.equal(map.resolve("extender1", 8), null);
  });

  it("clamps mappings when the channel count shrinks", () => {
    const map = new ChannelMap(mappingConfig({ bankStep: 24 }));
    map.setChannelCount(60);
    map.setBankOffset(48);
    map.setChannelCount(20);
    assert.equal(map.bankOffset, 0);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 1 });
  });

  it("keeps fixed surfaces in place while extenders bank through the remaining channels", () => {
    const fixedChannels = [1, 2, 3, 4, 5, 6, 7, 8];
    const map = new ChannelMap(
      mappingConfig({ layout: layoutConfig({ fixed: { main: fixedChannels } }) }),
    );
    map.setChannelCount(40);
    assert.equal(map.bankStep, 16);
    assert.equal(map.bankingPoolSize, 32);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 1 });
    assert.deepEqual(map.resolve("main", 7), { kind: "channel", channel: 8 });
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 9 });
    assert.deepEqual(map.resolve("extender1", 7), { kind: "channel", channel: 16 });
    assert.deepEqual(map.resolve("extender2", 0), { kind: "channel", channel: 17 });
    assert.deepEqual(map.resolve("extender2", 7), { kind: "channel", channel: 24 });

    assert.equal(map.bank("right"), true);
    assert.equal(map.bankOffset, 16);
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 1 });
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 25 });
    assert.deepEqual(map.resolve("extender2", 7), { kind: "channel", channel: 40 });
    assert.equal(map.bank("right"), false);
    assert.equal(map.bankPages, 2);
  });

  it("skips fixed channels and empty fixed slots in the banking pool", () => {
    const map = new ChannelMap(
      mappingConfig({
        layout: layoutConfig({ fixed: { main: [2, null, null, null, null, null, null, null] } }),
      }),
    );
    map.setChannelCount(10);
    assert.equal(map.bankStep, 16);
    assert.equal(map.bankingPoolSize, 9);
    const fixedTarget = map.resolve("main", 0);
    assert.equal(fixedTarget?.kind === "channel" ? fixedTarget.channel : null, 2);
    assert.equal(map.resolve("main", 1), null);
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 1 });
    assert.deepEqual(map.resolve("extender1", 1), { kind: "channel", channel: 3 });
    assert.deepEqual(map.resolve("extender2", 0), { kind: "channel", channel: 10 });
    assert.equal(map.resolve("extender2", 1), null);
    assert.equal(map.bank("right"), false);
  });

  it("uses the physical order of banking surfaces for the channel slices", () => {
    const map = new ChannelMap(
      mappingConfig({
        layout: layoutConfig({ order: ["extender2", "main", "extender1"] }),
      }),
    );
    map.setChannelCount(24);
    assert.deepEqual(map.resolve("extender2", 0), { kind: "channel", channel: 1 });
    assert.deepEqual(map.resolve("main", 0), { kind: "channel", channel: 9 });
    assert.deepEqual(map.resolve("extender1", 7), { kind: "channel", channel: 24 });
    assert.equal(map.bank("right"), false);
  });

  it("leaves disabled surfaces out of mapping and banking", () => {
    const map = new ChannelMap(
      mappingConfig({
        layout: layoutConfig({ fixed: { main: [1, 2, 3, 4, 5, 6, 7, 8] } }),
      }),
      { enabledRoles: ["main", "extender1"] },
    );
    map.setChannelCount(32);
    assert.equal(map.bankStep, 8);
    assert.equal(map.bankingPoolSize, 24);
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 9 });
    assert.equal(map.resolve("extender2", 0), null);
    assert.equal(map.bindings().some((binding) => binding.role === "extender2"), false);
  });

  it("keeps fixed channels out of the pool even when their surface is empty at that strip", () => {
    const map = new ChannelMap(
      mappingConfig({
        layout: layoutConfig({ fixed: { extender1: [null, null, null, null, null, null, null, 20] } }),
      }),
    );
    map.setChannelCount(24);
    const targets = map.bindings().filter((binding) => binding.target.kind === "channel").map((binding) =>
      binding.target.kind === "channel" ? binding.target.channel : 0,
    );
    assert.equal(new Set(targets).size, targets.length);
    assert.equal(map.bankStep, 16);
    assert.equal(map.bankingPoolSize, 23);
  });

  it("binds fixed bus targets while banking only through channels", () => {
    const layout = defaultLayout();
    layout.surfaces.main = {
      mode: "fixed",
      fixedTargets: [
        { kind: "bus", busType: "aux", index: 1 },
        { kind: "channel", channel: 1 },
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    };
    const map = new ChannelMap(mappingConfig({ layout }));
    map.setChannelCount(40);
    assert.deepEqual(map.resolve("main", 0), { kind: "bus", busType: "aux", index: 1 });
    assert.deepEqual(map.resolve("main", 1), { kind: "channel", channel: 1 });
    assert.equal(map.bankStep, 16);
    assert.equal(map.bankingPoolSize, 39);
    assert.deepEqual(map.resolve("extender1", 0), { kind: "channel", channel: 2 });
  });
});
