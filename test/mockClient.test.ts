import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { MockFairlightClient } from "../src/fairlight/mockClient.js";

describe("mock Fairlight client buses", () => {
  it("creates explicit bus specs with writable pan", async () => {
    const client = new MockFairlightClient({
      buses: [
        { type: "main", index: 1, name: "Main" },
        { type: "aux", index: 1, name: "Aux 1", pan: 0 },
      ],
    });
    await client.connect();

    const buses = client.snapshot().buses;
    assert.equal(buses.length, 2);
    const aux = buses.find((bus) => bus.type === "aux" && bus.index === 1);
    assert.equal(aux?.name, "Aux 1");
    assert.equal(aux?.pan, 0);
    assert.equal(aux?.writablePan, true);
    await assert.rejects(() => client.setBusPan("main", 1, 10));
    assert.equal(await client.setBusPan("aux", 1, 10), 10);
    assert.equal(client.snapshot().buses.find((bus) => bus.type === "aux")?.pan, 10);
  });

  it("keeps the default main buses when no specs are given", async () => {
    const client = new MockFairlightClient({ busCount: 2 });
    await client.connect();

    const buses = client.snapshot().buses;
    assert.deepEqual(buses.map((bus) => `${bus.type}:${bus.index}`), ["main:1", "main:2"]);
    assert.equal(buses.every((bus) => bus.writablePan === false), true);
  });
});
