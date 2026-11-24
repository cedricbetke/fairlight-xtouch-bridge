import { EmberServer, Model } from "@phillipivan/emberplus-connection";

import { BUS_TYPES, type BusType } from "../config.js";
import type { Logger } from "../logger.js";

export interface MockEmberProviderOptions {
  port: number;
  channelCount?: number;
  auxSendCount?: number;
  monitorCount?: number;
  logger: Logger;
  levelDecimals?: number;
}

interface ParameterNode {
  contents: {
    value?: unknown;
    identifier?: string;
    access?: string;
  };
}

function makeParameter(
  number: number,
  parameterType: Model.ParameterType,
  identifier: string,
  value: number | string | boolean | null,
  access: Model.ParameterAccess,
  minimum?: number,
  maximum?: number,
): Model.NumberedTreeNode<Model.EmberElement> {
  const contents = new Model.ParameterImpl(
    parameterType,
    identifier,
    undefined,
    value as never,
    maximum,
    minimum,
    access,
  );
  return new Model.NumberedTreeNodeImpl(
    number,
    contents as unknown as Model.EmberElement,
  );
}

function makeRoot(
  number: number,
  identifier: string,
  description: string,
  children: Array<Model.NumberedTreeNode<Model.EmberElement>>,
): Model.NumberedTreeNode<Model.EmberElement> {
  return new Model.NumberedTreeNodeImpl(
    number,
    new Model.EmberNodeImpl(identifier, description, true, true),
    Model.childrenOf(children),
  );
}

export class MockEmberProvider {
  readonly #options: MockEmberProviderOptions;
  readonly #logger: Logger;
  readonly #server: EmberServer;
  readonly #channelNodes = new Map<number, Model.NumberedTreeNode<Model.EmberElement>>();
  readonly #channelSendNodes = new Map<string, Model.NumberedTreeNode<Model.EmberElement>>();
  readonly #busNodes = new Map<string, Model.NumberedTreeNode<Model.EmberElement>>();
  readonly #monitorNodes = new Map<number, Model.NumberedTreeNode<Model.EmberElement>>();
  #channelRoot: Model.NumberedTreeNode<Model.EmberElement> | null = null;
  #started = false;

  constructor(options: MockEmberProviderOptions) {
    this.#options = options;
    this.#logger = options.logger.child({ component: "mock-ember" });
    this.#server = new EmberServer(options.port, "127.0.0.1");
  }

  async start(): Promise<void> {
    if (this.#started) return;
    const channelChildren: Array<Model.NumberedTreeNode<Model.EmberElement>> = [];
    const channelCount = this.#options.channelCount ?? 24;
    const auxSendCount = this.#options.auxSendCount ?? 2;
    for (let index = 1; index <= channelCount; index += 1) {
      const auxNodes: Array<Model.NumberedTreeNode<Model.EmberElement>> = [];
      for (let aux = 1; aux <= auxSendCount; aux += 1) {
        const sendNode = new Model.NumberedTreeNodeImpl(
          aux,
          new Model.EmberNodeImpl(`aux${aux}`, `AUX ${aux}`),
          Model.childrenOf([
            makeParameter(1, Model.ParameterType.Real, "level", -12, Model.ParameterAccess.ReadWrite, -100, 10),
            makeParameter(2, Model.ParameterType.Boolean, "mute", false, Model.ParameterAccess.ReadWrite),
            makeParameter(3, Model.ParameterType.Real, "pan", 0, Model.ParameterAccess.ReadWrite, -100, 100),
          ]),
        );
        this.#channelSendNodes.set(`${index}:${aux}`, sendNode);
        auxNodes.push(sendNode);
      }
      const sendsNode = new Model.NumberedTreeNodeImpl(
        6,
        new Model.EmberNodeImpl("sends", "Sends"),
        Model.childrenOf([
          new Model.NumberedTreeNodeImpl(
            1,
            new Model.EmberNodeImpl("aux", "Aux Sends"),
            Model.childrenOf(auxNodes),
          ),
        ]),
      );
      const node = new Model.NumberedTreeNodeImpl(
        index,
        new Model.EmberNodeImpl(`channel${index}`, `CH ${String(index).padStart(2, "0")}`),
        Model.childrenOf([
          makeParameter(1, Model.ParameterType.Real, "level", -12 + ((index - 1) % 6), Model.ParameterAccess.ReadWrite, -100, 10),
          makeParameter(2, Model.ParameterType.Boolean, "mute", false, Model.ParameterAccess.ReadWrite),
          makeParameter(3, Model.ParameterType.String, "name", `CH ${String(index).padStart(2, "0")}`, Model.ParameterAccess.ReadWrite),
          makeParameter(4, Model.ParameterType.Real, "pan", 0, Model.ParameterAccess.ReadWrite, -100, 100),
          makeParameter(5, Model.ParameterType.Real, "meter", -60, Model.ParameterAccess.Read, -60, 0),
          sendsNode,
        ]),
      );
      this.#channelNodes.set(index, node);
      channelChildren.push(node);
    }

    const busRoots: Array<Model.NumberedTreeNode<Model.EmberElement>> = [];
    for (const [typeIndex, type] of BUS_TYPES.entries()) {
      const nodes: Array<Model.NumberedTreeNode<Model.EmberElement>> = [];
      for (let index = 1; index <= 2; index += 1) {
        const node = new Model.NumberedTreeNodeImpl(
          index,
          new Model.EmberNodeImpl(`${type}${index}`, `${type.toUpperCase()} ${index}`),
          Model.childrenOf([
            makeParameter(1, Model.ParameterType.Real, "level", -6, Model.ParameterAccess.ReadWrite, -100, 10),
            makeParameter(2, Model.ParameterType.Boolean, "mute", false, Model.ParameterAccess.ReadWrite),
            makeParameter(3, Model.ParameterType.String, "name", `${type.toUpperCase()} ${index}`, Model.ParameterAccess.ReadWrite),
          ]),
        );
        this.#busNodes.set(`${type}:${index}`, node);
        nodes.push(node);
      }
      busRoots.push(makeRoot(2 + typeIndex, type, type.toUpperCase(), nodes));
    }

    this.#channelRoot = makeRoot(1, "channel", "Channels", channelChildren);
    const monitorChildren: Array<Model.NumberedTreeNode<Model.EmberElement>> = [];
    const monitorCount = this.#options.monitorCount ?? 4;
    for (let index = 1; index <= monitorCount; index += 1) {
      const node = new Model.NumberedTreeNodeImpl(
        index,
        new Model.EmberNodeImpl(`monitor${index}`, `MON ${index}`),
        Model.childrenOf([
          makeParameter(1, Model.ParameterType.Real, "level", -6, Model.ParameterAccess.ReadWrite, -100, 10),
          makeParameter(2, Model.ParameterType.Boolean, "mute", false, Model.ParameterAccess.ReadWrite),
          makeParameter(3, Model.ParameterType.Boolean, "dim", false, Model.ParameterAccess.ReadWrite),
        ]),
      );
      this.#monitorNodes.set(index, node);
      monitorChildren.push(node);
    }
    const tree = Model.childrenOf([
      makeRoot(0, "system", "System", [
        new Model.NumberedTreeNodeImpl(1, new Model.EmberNodeImpl("loudness", "Loudness")),
      ]),
      this.#channelRoot,
      ...busRoots,
      makeRoot(8, "monitor", "Monitoring", monitorChildren),
    ]);

    this.#server.onSetValue = async (node, value) => {
      const parameter = node as unknown as ParameterNode;
      const identifier = parameter.contents.identifier;
      let applied: unknown = value;
      if (parameter.contents.access !== Model.ParameterAccess.ReadWrite) {
        this.#logger.warn("mock_ember.rejected_read_only", { identifier });
        return false;
      }
      if (identifier === "level") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < -100 || value > 10) return false;
        if (this.#options.levelDecimals !== undefined) {
          const factor = 10 ** this.#options.levelDecimals;
          applied = Math.round(value * factor) / factor;
        }
      } else if (identifier === "mute") {
        if (typeof value !== "boolean") return false;
      } else if (identifier === "name") {
        if (typeof value !== "string") return false;
      } else if (identifier === "pan") {
        if (typeof value !== "number" || value < -100 || value > 100) return false;
      } else if (identifier === "dim") {
        if (typeof value !== "boolean") return false;
      } else {
        return false;
      }
      this.#server.update(node, { value: applied } as never);
      this.#logger.debug("mock_ember.value_set", { identifier, value: applied });
      return true;
    };

    await this.#server.init(tree);
    this.#started = true;
    this.#logger.info("mock_ember.listening", {
      host: "127.0.0.1",
      port: this.#options.port,
      channels: channelCount,
    });
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.disconnectClients();
    this.#server.discard();
    this.#logger.info("mock_ember.stopped");
  }

  disconnectClients(): void {
    const clients = (this.#server as unknown as {
      _clients?: Set<{ handleClose?: () => void; socket?: { destroy: () => void } }>;
    })._clients;
    for (const client of clients ?? []) {
      try {
        client.handleClose?.();
        client.socket?.destroy();
      } catch {}
    }
  }

  updateChannel(index: number, fields: { levelDb?: number; muted?: boolean; name?: string; pan?: number }): boolean {
    const node = this.#channelNodes.get(index);
    if (!node?.children) return false;
    let updated = false;
    for (const child of node.children.values()) {
      const identifier = (child as unknown as ParameterNode).contents.identifier;
      const parameter = child as unknown as Model.NumberedTreeNode<Model.EmberElement>;
      if (identifier === "level" && fields.levelDb !== undefined) {
        this.#server.update(parameter, { value: fields.levelDb } as never);
        updated = true;
      } else if (identifier === "mute" && fields.muted !== undefined) {
        this.#server.update(parameter, { value: fields.muted } as never);
        updated = true;
      } else if (identifier === "name" && fields.name !== undefined) {
        this.#server.update(parameter, { value: fields.name } as never);
        updated = true;
      } else if (identifier === "pan" && fields.pan !== undefined) {
        this.#server.update(parameter, { value: fields.pan } as never);
        updated = true;
      }
    }
    return updated;
  }

  updateChannelSend(channelIndex: number, auxIndex: number, fields: { levelDb?: number; muted?: boolean; pan?: number }): boolean {
    const node = this.#channelSendNodes.get(`${channelIndex}:${auxIndex}`);
    if (!node?.children) return false;
    let updated = false;
    for (const child of node.children.values()) {
      const identifier = (child as unknown as ParameterNode).contents.identifier;
      const parameter = child as unknown as Model.NumberedTreeNode<Model.EmberElement>;
      if (identifier === "level" && fields.levelDb !== undefined) {
        this.#server.update(parameter, { value: fields.levelDb } as never);
        updated = true;
      } else if (identifier === "mute" && fields.muted !== undefined) {
        this.#server.update(parameter, { value: fields.muted } as never);
        updated = true;
      } else if (identifier === "pan" && fields.pan !== undefined) {
        this.#server.update(parameter, { value: fields.pan } as never);
        updated = true;
      }
    }
    return updated;
  }

  updateBus(type: BusType, index: number, fields: { levelDb?: number; muted?: boolean; name?: string }): boolean {
    const node = this.#busNodes.get(`${type}:${index}`);
    if (!node?.children) return false;
    let updated = false;
    for (const child of node.children.values()) {
      const identifier = (child as unknown as ParameterNode).contents.identifier;
      const parameter = child as unknown as Model.NumberedTreeNode<Model.EmberElement>;
      if (identifier === "level" && fields.levelDb !== undefined) {
        this.#server.update(parameter, { value: fields.levelDb } as never);
        updated = true;
      } else if (identifier === "mute" && fields.muted !== undefined) {
        this.#server.update(parameter, { value: fields.muted } as never);
        updated = true;
      } else if (identifier === "name" && fields.name !== undefined) {
        this.#server.update(parameter, { value: fields.name } as never);
        updated = true;
      }
    }
    return updated;
  }

  updateMonitor(index: number, fields: { levelDb?: number; muted?: boolean; dimmed?: boolean }): boolean {
    const node = this.#monitorNodes.get(index);
    if (!node?.children) return false;
    let updated = false;
    for (const child of node.children.values()) {
      const identifier = (child as unknown as ParameterNode).contents.identifier;
      const parameter = child as unknown as Model.NumberedTreeNode<Model.EmberElement>;
      if (identifier === "level" && fields.levelDb !== undefined) {
        this.#server.update(parameter, { value: fields.levelDb } as never);
        updated = true;
      } else if (identifier === "mute" && fields.muted !== undefined) {
        this.#server.update(parameter, { value: fields.muted } as never);
        updated = true;
      } else if (identifier === "dim" && fields.dimmed !== undefined) {
        this.#server.update(parameter, { value: fields.dimmed } as never);
        updated = true;
      }
    }
    return updated;
  }

  touchChannelRoot(description: string): boolean {
    if (!this.#channelRoot) return false;
    this.#server.update(this.#channelRoot, { description } as never);
    return true;
  }
}
