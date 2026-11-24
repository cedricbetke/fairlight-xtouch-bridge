import { getLanguage, initI18n, setLanguage } from "./i18n.js";

const SURFACE_ROLES = ["main", "extender1", "extender2"];
const STRIPS_PER_SURFACE = 8;
const SELECT_NOTE_BASE = 0x18;
const DEFAULT_NETWORK_PORT = 5004;

const ENCODER_LABELS = {
  off: "Aus",
  pan: "Pan",
};

const ROLE_TITLES = {
  main: "X-Touch Main",
  extender1: "Extender 1",
  extender2: "Extender 2",
};

const ROLE_SUBTITLES = {
  main: "Hauptgerät · Bank-Tasten",
  extender1: "Erweiterung",
  extender2: "Erweiterung",
};

const DEFAULT_PORTS = {
  main: "X-Touch INT",
  extender1: "X-Touch Extender",
  extender2: "X-Touch Extender",
};

function isMainRole(role) {
  return state.devices[role]?.kind === "main";
}

function rolePlaceholder(role) {
  if (isMainRole(role)) return "X-Touch Main";
  const extenders = state.order.filter((other) => !isMainRole(other));
  const index = extenders.indexOf(role);
  return index >= 0 ? `Extender ${index + 1}` : "X-Touch Extender";
}

function roleSubtitle(role) {
  return isMainRole(role) ? "Hauptgerät · Bank-Tasten" : "Erweiterung";
}

function roleShort(role) {
  const custom = state.devices[role]?.name;
  if (custom) return custom;
  if (isMainRole(role)) return "Main";
  const extenders = state.order.filter((other) => !isMainRole(other));
  const index = extenders.indexOf(role);
  return index >= 0 ? `Ext. ${index + 1}` : "Ext.";
}

function nextRoleId() {
  let index = 1;
  while (state.devices[`extender${index}`]) index += 1;
  return `extender${index}`;
}

function defaultDevice(role) {
  const preferred = DEFAULT_PORTS[role] ?? "X-Touch Extender";
  const occurrence = role === "extender2" ? 1 : 0;
  return {
    name: null,
    kind: role === "main" ? "main" : "extender",
    enabled: true,
    transport: "usb",
    input: { name: preferred, occurrence },
    output: { name: preferred, occurrence },
    network: { host: "", port: DEFAULT_NETWORK_PORT },
    encoder: "off",
    meters: false,
    mainDisplay: { mode: "off", scope: "surface", meter: null },
  };
}

const MAIN_DISPLAY_MODES = ["off", "auto", "channels", "clock", "on-air", "meter"];
const MAIN_DISPLAY_MEASUREMENTS = ["loudness", "headroom"];

function normalizeMainDisplayMeter(value) {
  if (!value || typeof value !== "object") return null;
  const target = normalizeFixedTarget(value.target);
  if (!target || target.kind !== "bus") return null;
  const measurement = MAIN_DISPLAY_MEASUREMENTS.includes(value.measurement) ? value.measurement : "loudness";
  return { measurement, target: { kind: "bus", busType: target.busType, index: target.index } };
}

function normalizeMainDisplay(value) {
  const mode = MAIN_DISPLAY_MODES.includes(value?.mode) ? value.mode : "off";
  const scope = value?.scope === "main" ? "main" : "surface";
  return { mode, scope, meter: normalizeMainDisplayMeter(value?.meter) };
}

const BUS_LABELS = {
  main: "MAIN",
  sub: "SUB",
  aux: "AUX",
  mixm: "MIX-M",
  mtx: "MTX",
  vca: "VCA",
};

const LCD_COLORS = ["off", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

const LCD_COLOR_LABELS = {
  off: "Aus",
  red: "Rot",
  green: "Grün",
  yellow: "Gelb",
  blue: "Blau",
  magenta: "Magenta",
  cyan: "Cyan",
  white: "Weiß",
};

const LCD_COLOR_CSS = {
  red: "#cc0000",
  green: "#00bb22",
  yellow: "#ffcc00",
  blue: "#0000ff",
  magenta: "#ff33cc",
  cyan: "#33ccdd",
  white: "#cccccc",
};

const LCD_LIGHT_TEXT_COLORS = new Set(["#cc0000", "#0000ff"]);

function lcdTextTone(color) {
  if (!color) return "";
  return LCD_LIGHT_TEXT_COLORS.has(color) ? " lcd-light" : " lcd-dark";
}

const LCD_LINE_LABELS = {
  name: "Fairlight-Name",
  custom: "Kurzname, sonst Name",
  "type-number": "Typ + Nummer",
  type: "Nur Typ",
  number: "Nur Nummer",
  value: "Faderwert (dB)",
  target: "Aktives Faderziel",
  blank: "Leer",
};

const LCD_PALETTE_KEYS = ["channel", "main", "sub", "aux", "mixm", "mtx", "vca"];

const LCD_PALETTE_LABELS = {
  channel: "Eingänge",
  main: "Main",
  sub: "Subgruppen",
  aux: "Aux",
  mixm: "Mix-Minus",
  mtx: "Matrix",
  vca: "VCA/DCA",
};

const DEFAULT_LCD_PALETTE = {
  channel: "white",
  main: "red",
  sub: "blue",
  aux: "cyan",
  mixm: "magenta",
  mtx: "yellow",
  vca: "green",
};

const dom = {
  modeBadge: document.getElementById("modeBadge"),
  fairlightPill: document.getElementById("fairlightPill"),
  fairlightStatus: document.getElementById("fairlightStatus"),
  onAirBadge: document.getElementById("onAirBadge"),
  channelCount: document.getElementById("channelCount"),
  discoverForm: document.getElementById("discoverForm"),
  fairlightHost: document.getElementById("fairlightHost"),
  fairlightPort: document.getElementById("fairlightPort"),
  discoverButton: document.getElementById("discoverButton"),
  discoverMessage: document.getElementById("discoverMessage"),
  deviceDialog: document.getElementById("deviceDialog"),
  deviceDialogTitle: document.getElementById("deviceDialogTitle"),
  deviceDialogContext: document.getElementById("deviceDialogContext"),
  deviceDialogClose: document.getElementById("deviceDialogClose"),
  deviceDialogDeck: document.getElementById("deviceDialogDeck"),
  fkeyEditor: document.getElementById("fkeyEditor"),
  deviceStripHint: document.getElementById("deviceStripHint"),
  selectedButton: document.getElementById("selectedButton"),
  buttonFunction: document.getElementById("buttonFunction"),
  buttonAuxField: document.getElementById("buttonAuxField"),
  buttonAux: document.getElementById("buttonAux"),
  buttonMonitorField: document.getElementById("buttonMonitorField"),
  buttonMonitor: document.getElementById("buttonMonitor"),
  buttonHint: document.getElementById("buttonHint"),
  mainDisplayEditor: document.getElementById("mainDisplayEditor"),
  mainDisplayMode: document.getElementById("mainDisplayMode"),
  mainDisplayScopeField: document.getElementById("mainDisplayScopeField"),
  mainDisplayScope: document.getElementById("mainDisplayScope"),
  mainDisplayMeasurementField: document.getElementById("mainDisplayMeasurementField"),
  mainDisplayMeasurement: document.getElementById("mainDisplayMeasurement"),
  mainDisplayTargetField: document.getElementById("mainDisplayTargetField"),
  mainDisplayTarget: document.getElementById("mainDisplayTarget"),
  mainDisplaySim: document.getElementById("mainDisplaySim"),
  mainDisplayHint: document.getElementById("mainDisplayHint"),
  singleChannelNotice: document.getElementById("singleChannelNotice"),
  deviceRow: document.getElementById("deviceRow"),
  addDevice: document.getElementById("addDevice"),
  refreshPorts: document.getElementById("refreshPorts"),
  portsMessage: document.getElementById("portsMessage"),
  bankPrev: document.getElementById("bankPrev"),
  bankNext: document.getElementById("bankNext"),
  bankLabel: document.getElementById("bankLabel"),
  saveState: document.getElementById("saveState"),
  saveButton: document.getElementById("saveButton"),
  reloadButton: document.getElementById("reloadButton"),
  lcdSummary: document.getElementById("lcdSummary"),
  lcdEnabled: document.getElementById("lcdEnabled"),
  lcdLine1: document.getElementById("lcdLine1"),
  lcdLine2: document.getElementById("lcdLine2"),
  lcdReset: document.getElementById("lcdReset"),
  lcdPalette: document.getElementById("lcdPalette"),
  lcdSearch: document.getElementById("lcdSearch"),
  lcdOverrideList: document.getElementById("lcdOverrideList"),
  channelDialog: document.getElementById("channelDialog"),
  channelDialogTitle: document.getElementById("channelDialogTitle"),
  channelDialogContext: document.getElementById("channelDialogContext"),
  channelDialogClose: document.getElementById("channelDialogClose"),
  channelSearch: document.getElementById("channelSearch"),
  channelList: document.getElementById("channelList"),
  channelClear: document.getElementById("channelClear"),
  channelHint: document.getElementById("channelHint"),
  toastRegion: document.getElementById("toastRegion"),
  langSelect: document.getElementById("langSelect"),
  navApp: document.getElementById("navApp"),
  appPanel: document.getElementById("app"),
  appStatus: document.getElementById("appStatus"),
  appBridge: document.getElementById("appBridge"),
  appFairlight: document.getElementById("appFairlight"),
  appDevices: document.getElementById("appDevices"),
  appAutostart: document.getElementById("appAutostart"),
  appWrites: document.getElementById("appWrites"),
  appMotors: document.getElementById("appMotors"),
  allowedChannels: document.getElementById("allowedChannels"),
  allowedBuses: document.getElementById("allowedBuses"),
  allowedMonitors: document.getElementById("allowedMonitors"),
  appError: document.getElementById("appError"),
  appMessage: document.getElementById("appMessage"),
  saveHint: document.getElementById("saveHint"),
};

initI18n();
dom.langSelect.value = getLanguage();

const cardRefs = new Map();
let state = createInitialState();
let previewToken = 0;
let previewTimer = null;
let demoPollTimer = null;
let onAirPollTimer = null;
let dialogContext = null;
let draggingRole = null;
let dragFindRole = null;
/** Sends-on-fader simulation inside the main display editor. */
let dialogSendActive = false;
/** On-air simulation inside the main display editor; `null` follows Fairlight. */
let dialogOnAirSim = null;
let segmentClockTimer = null;

function createDefaultLcdState() {
  return {
    colorsEnabled: true,
    line1: "custom",
    line2: "type-number",
    palette: { ...DEFAULT_LCD_PALETTE },
    overrides: new Map(),
  };
}

function lcdTargetStorageKey(target) {
  if (!target) return "";
  return target.kind === "channel" ? `channel:${target.channel}` : `bus:${target.busType}:${target.index}`;
}

function normalizeLcdColor(value, fallback) {
  return LCD_COLORS.includes(value) ? value : fallback;
}

function normalizeLcdConfig(source) {
  const lcd = createDefaultLcdState();
  if (!source || typeof source !== "object") return lcd;
  if (typeof source.colorsEnabled === "boolean") lcd.colorsEnabled = source.colorsEnabled;
  if (Object.prototype.hasOwnProperty.call(LCD_LINE_LABELS, source.line1)) lcd.line1 = source.line1;
  if (Object.prototype.hasOwnProperty.call(LCD_LINE_LABELS, source.line2)) lcd.line2 = source.line2;
  if (source.palette && typeof source.palette === "object") {
    for (const key of LCD_PALETTE_KEYS) {
      lcd.palette[key] = normalizeLcdColor(source.palette[key], DEFAULT_LCD_PALETTE[key]);
    }
  }
  if (Array.isArray(source.overrides)) {
    for (const entry of source.overrides) {
      const target = normalizeFixedTarget(entry?.target);
      if (!target) continue;
      const color =
        entry.color === "auto" ? "auto" : LCD_COLORS.includes(entry.color) ? entry.color : "auto";
      const name =
        typeof entry.name === "string" && entry.name.trim() !== ""
          ? entry.name.trim().slice(0, 7)
          : null;
      const expectedName =
        typeof entry.expectedName === "string" && entry.expectedName.trim() !== ""
          ? entry.expectedName.trim()
          : null;
      if (color === "auto" && name === null) continue;
      lcd.overrides.set(lcdTargetStorageKey(target), { target, color, name, expectedName });
    }
  }
  return lcd;
}

function buildLcdConfig() {
  return {
    colorsEnabled: state.lcd.colorsEnabled,
    line1: state.lcd.line1,
    line2: state.lcd.line2,
    palette: { ...state.lcd.palette },
    overrides: [...state.lcd.overrides.values()].map((entry) => ({
      target: entry.target,
      color: entry.color,
      name: entry.name,
      expectedName: entry.expectedName,
    })),
  };
}

function lcdTargetLabel(target) {
  return target.kind === "channel"
    ? `CH ${String(target.channel).padStart(2, "0")}`
    : `${BUS_LABELS[target.busType] ?? target.busType.toUpperCase()} ${target.index}`;
}

function lcdTargetName(target) {
  return target.kind === "channel"
    ? state.channelByName.get(target.channel) ?? `Kanal ${target.channel}`
    : state.busByName.get(busStorageKey(target.busType, target.index)) ?? lcdTargetLabel(target);
}

function lcdTargets() {
  const result = [];
  for (const bus of state.buses) {
    result.push({ target: { kind: "bus", busType: bus.type, index: bus.index }, name: bus.name });
  }
  for (const channel of state.channels) {
    result.push({ target: { kind: "channel", channel: channel.index }, name: channel.name });
  }
  return result;
}

function effectiveLcdColor(target, override) {
  if (!state.lcd.colorsEnabled) return "off";
  if (override && override.color !== "auto") return override.color;
  return state.lcd.palette[target.kind === "channel" ? "channel" : target.busType] ?? "off";
}

function colorDotStyle(color) {
  return color && LCD_COLOR_CSS[color] ? LCD_COLOR_CSS[color] : "transparent";
}

function createInitialState() {
  const surfaces = {};
  const devices = {};
  const ledOn = {};
  for (const role of SURFACE_ROLES) {
    surfaces[role] = { mode: "banking", fixedTargets: Array(STRIPS_PER_SURFACE).fill(null) };
    devices[role] = {
      ...defaultDevice(role),
      input: { name: DEFAULT_PORTS[role], occurrence: role === "extender2" ? 1 : 0 },
      output: { name: DEFAULT_PORTS[role], occurrence: role === "extender2" ? 1 : 0 },
    };
    ledOn[role] = new Set();
  }
  return {
    demo: false,
    configPath: "",
    config: null,
    app: null,
    channels: [],
    channelByName: new Map(),
    buses: [],
    busByName: new Map(),
    monitors: [],
    midi: { inputs: [], outputs: [], error: null },
    order: [...SURFACE_ROLES],
    surfaces,
    devices,
    fairlight: { host: "127.0.0.1", port: 9000 },
    onAir: null,
    sendsOnFader: { enabled: false, busIndex: 1 },
    buttonAssignments: {},
    selectedButton: "f1",
    dialogRole: null,
    dialogOpener: null,
    lcd: createDefaultLcdState(),
    lcdSearch: "",
    preview: null,
    bankOffset: 0,
    dirty: false,
    saving: false,
    findingRoles: new Set(),
    ledOn,
    discoverError: null,
    loading: true,
    demoSince: 0,
  };
}

function api(path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) };
  return fetch(path, { ...options, headers }).then(async (response) => {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data && typeof data.error === "string" ? data.error : `Anfrage fehlgeschlagen (${response.status})`);
    }
    return data;
  });
}

function showToast(message, kind = "info", timeout = 4200) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.kind = kind;
  toast.textContent = message;
  dom.toastRegion.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, timeout);
}

function setDiscoverMessage(text, tone = "") {
  dom.discoverMessage.textContent = text;
  if (tone) dom.discoverMessage.dataset.tone = tone;
  else delete dom.discoverMessage.dataset.tone;
}

function selectorKey(selector) {
  return JSON.stringify({ name: selector.name, occurrence: selector.occurrence });
}

function cloneSelector(selector) {
  return { name: selector.name, occurrence: selector.occurrence };
}

function describePorts(ports) {
  const totals = new Map();
  for (const port of ports) totals.set(port.name, (totals.get(port.name) ?? 0) + 1);
  const seen = new Map();
  return ports.map((port) => {
    const occurrence = seen.get(port.name) ?? 0;
    seen.set(port.name, occurrence + 1);
    return { index: port.index, name: port.name, occurrence, total: totals.get(port.name) ?? 1 };
  });
}

function portLabel(port) {
  return port.total > 1 ? `${port.name} · #${port.occurrence + 1}` : port.name;
}

function selectorLabel(selector) {
  if (!selector || typeof selector.name !== "string" || selector.name === "") return "nicht gewählt";
  return `${selector.name} · #${selector.occurrence + 1}`;
}

function findPort(ports, selector) {
  if (!selector || typeof selector.name !== "string") return null;
  return describePorts(ports).find((port) => port.name === selector.name && port.occurrence === selector.occurrence) ?? null;
}

function busStorageKey(busType, index) {
  return `${busType}:${index}`;
}

function targetKey(target) {
  if (!target) return "";
  return target.kind === "channel" ? `channel:${target.channel}` : `bus:${target.busType}:${target.index}`;
}

function normalizeFixedTarget(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { kind: "channel", channel: value };
  }
  if (typeof value !== "object") return null;
  if (value.kind === "channel" && Number.isInteger(value.channel) && value.channel > 0) {
    return { kind: "channel", channel: value.channel };
  }
  if (
    value.kind === "bus" &&
    typeof value.busType === "string" &&
    BUS_LABELS[value.busType] &&
    Number.isInteger(value.index) &&
    value.index > 0
  ) {
    return { kind: "bus", busType: value.busType, index: value.index };
  }
  return null;
}

function targetLabel(target) {
  if (!target) return "—";
  if (target.kind === "channel") return `CH ${String(target.channel).padStart(2, "0")}`;
  return `${BUS_LABELS[target.busType] ?? target.busType.toUpperCase()} ${target.index}`;
}

function targetName(target) {
  if (!target) return "Frei";
  if (target.kind === "channel") return state.channelByName.get(target.channel) ?? `Kanal ${target.channel}`;
  return state.busByName.get(busStorageKey(target.busType, target.index)) ?? targetLabel(target);
}

function targetInfo(target) {
  if (!target) return null;
  if (target.kind === "channel") {
    return {
      kind: "channel",
      channel: target.channel,
      busType: null,
      index: null,
      name: state.channelByName.get(target.channel) ?? null,
    };
  }
  return {
    kind: "bus",
    channel: null,
    busType: target.busType,
    index: target.index,
    name: state.busByName.get(busStorageKey(target.busType, target.index)) ?? null,
  };
}

function markDirty() {
  if (state.dirty) return;
  state.dirty = true;
  updateSavebar();
}

function markClean() {
  state.dirty = false;
  updateSavebar();
}

function updateSavebar() {
  dom.saveState.textContent = state.saving
    ? "Wird gespeichert …"
    : state.dirty
      ? "Ungespeicherte Änderungen"
      : "Alles gespeichert";
  dom.saveState.dataset.dirty = String(state.dirty);
  dom.saveButton.disabled = !state.dirty || state.saving;
  dom.saveButton.textContent = state.saving ? "Speichert …" : "Speichern";
  dom.reloadButton.disabled = !state.dirty || state.saving;
}

let saveHintDesktop = null;

function applySaveHint(desktop) {
  if (saveHintDesktop === desktop) return;
  saveHintDesktop = desktop;
  dom.saveHint.textContent = desktop
    ? "Änderungen werden direkt nach dem Speichern übernommen."
    : "Änderungen gelten ab dem nächsten Bridge-Start.";
}

function renderAppPanel() {
  const app = state.app;
  if (!app) {
    dom.appPanel.hidden = true;
    dom.navApp.hidden = true;
    applySaveHint(false);
    return;
  }
  dom.appPanel.hidden = false;
  dom.navApp.hidden = false;
  applySaveHint(true);

  const bridge = app.bridge ?? {};
  const running = Boolean(bridge.running);
  dom.appStatus.textContent = running ? "Bridge läuft" : "Bridge gestoppt";
  dom.appBridge.textContent = running ? "Läuft" : "Gestoppt";
  if (bridge.fairlightConnected) {
    dom.appFairlight.textContent =
      app.onAir === null ? "Verbunden" : app.onAir ? "Verbunden · ON AIR" : "Verbunden · OFF AIR";
  } else {
    dom.appFairlight.textContent = "Nicht verbunden";
  }
  dom.appDevices.textContent =
    bridge.devicesEnabled > 0
      ? `${bridge.devicesOnline} von ${bridge.devicesEnabled} online`
      : "Keine Geräte eingerichtet";
  if (bridge.lastError) {
    dom.appError.hidden = false;
    dom.appError.textContent = bridge.lastError;
  } else {
    dom.appError.hidden = true;
    dom.appError.textContent = "";
  }

  dom.appAutostart.checked = Boolean(app.autostart);
  dom.appAutostart.disabled = !app.autostartSupported;
  dom.appWrites.checked = Boolean(app.arming?.writes);
  dom.appMotors.checked = Boolean(app.arming?.motors);
  dom.appMotors.disabled = !dom.appWrites.checked;
}

let appUpdatePending = false;

function parseNumberList(text, label) {
  const values = [];
  for (const token of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const value = Number(token);
    if (!Number.isInteger(value) || value < 1) {
      showToast(`${label}: „${token}“ ist keine gültige Nummer.`, "error", 6000);
      return null;
    }
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function parseBusList(text) {
  const values = [];
  for (const token of String(text).split(/[\s,;]+/).filter(Boolean)) {
    if (!/^[a-z]+:\d+$/.test(token)) {
      showToast(`Busse: „${token}“ muss die Form main:1 haben.`, "error", 6000);
      return null;
    }
    if (!values.includes(token)) values.push(token);
  }
  return values;
}

function buildSafety() {
  const channels = parseNumberList(dom.allowedChannels.value, "Kanäle");
  if (channels === null) return null;
  const buses = parseBusList(dom.allowedBuses.value);
  if (buses === null) return null;
  const monitors = parseNumberList(dom.allowedMonitors.value, "Monitore");
  if (monitors === null) return null;
  return {
    allowedWriteChannels: channels,
    allowedWriteBuses: buses,
    allowedWriteMonitors: monitors,
  };
}

function renderSafetyFields() {
  const safety = state.config?.safety;
  if (!safety || !state.app) return;
  dom.allowedChannels.value = (safety.allowedWriteChannels ?? []).join(", ");
  dom.allowedBuses.value = (safety.allowedWriteBuses ?? []).join(", ");
  dom.allowedMonitors.value = (safety.allowedWriteMonitors ?? []).join(", ");
}

async function updateAppSettings(patch) {
  if (appUpdatePending) return;
  appUpdatePending = true;
  dom.appMessage.textContent = "Wird übernommen …";
  try {
    const data = await api("/api/app", { method: "POST", body: JSON.stringify(patch) });
    if (data?.app) state.app = data.app;
    renderAppPanel();
    const safety = state.config?.safety;
    if (
      data?.app?.arming?.writes &&
      safety &&
      (safety.allowedWriteChannels?.length ?? 0) === 0 &&
      (safety.allowedWriteBuses?.length ?? 0) === 0 &&
      (safety.allowedWriteMonitors?.length ?? 0) === 0
    ) {
      showToast(
        "Schreibzugriff ist aktiv, aber keine Ziele sind freigegeben. Trage Kanäle, Busse oder Monitore ein und speichere.",
        "info",
        8000,
      );
    }
    dom.appMessage.textContent = "Übernommen.";
    window.setTimeout(() => {
      if (dom.appMessage.textContent === "Übernommen.") dom.appMessage.textContent = "";
    }, 3000);
  } catch (error) {
    dom.appMessage.textContent = error.message;
    showToast(error.message, "error", 6000);
    await refreshAppInfo();
  } finally {
    appUpdatePending = false;
  }
}

async function refreshAppInfo() {
  if (!state.app) return;
  try {
    const data = await api("/api/app");
    if (!data?.app) return;
    if (JSON.stringify(data.app) === JSON.stringify(state.app)) return;
    state.app = data.app;
    renderAppPanel();
  } catch {
    // The settings page keeps working with the last known status.
  }
}

let appPollTimer = null;

function startAppStatusPolling() {
  if (appPollTimer) {
    window.clearInterval(appPollTimer);
    appPollTimer = null;
  }
  if (!state.app) return;
  appPollTimer = window.setInterval(() => {
    void refreshAppInfo();
  }, 3000);
}

function buildLayout() {
  const surfaces = {};
  for (const role of state.order) {
    const surface = state.surfaces[role];
    surfaces[role] = {
      mode: surface.mode,
      fixedTargets: surface.mode === "fixed" ? surface.fixedTargets.slice(0, STRIPS_PER_SURFACE) : [],
    };
  }
  return { order: [...state.order], surfaces };
}

function enabledRoles() {
  return state.order.filter(
    (role) =>
      state.devices[role] &&
      state.devices[role].enabled &&
      state.devices[role].transport !== "network",
  );
}

function previewFor(role) {
  return state.preview?.surfaces.find((surface) => surface.role === role) ?? null;
}

function fixedOwner(target, excludeRole, excludeStrip) {
  const key = targetKey(target);
  if (!key) return null;
  for (const role of state.order) {
    const surface = state.surfaces[role];
    if (surface.mode !== "fixed") continue;
    for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
      if (role === excludeRole && strip === excludeStrip) continue;
      if (targetKey(surface.fixedTargets[strip]) === key) return { role, strip };
    }
  }
  return null;
}

function applyState(data) {
  const onAirValue = data.fairlight?.onAir ?? data.onAir;
  state = {
    ...state,
    demo: Boolean(data.demo),
    configPath: data.configPath ?? "",
    config: data.config ?? null,
    app: data.app ?? null,
    onAir: !data.demo && typeof onAirValue === "boolean" ? onAirValue : null,
    midi: {
      inputs: Array.isArray(data.midi?.inputs) ? data.midi.inputs : [],
      outputs: Array.isArray(data.midi?.outputs) ? data.midi.outputs : [],
      error: data.midi?.error ?? null,
    },
    fairlight: {
      host: data.fairlight?.host ?? data.config?.fairlight?.host ?? "127.0.0.1",
      port: data.fairlight?.port ?? data.config?.fairlight?.port ?? 9000,
    },
    sendsOnFader: {
      enabled: Boolean(data.config?.mapping?.sendsOnFader?.enabled),
      busIndex: Number.isInteger(data.config?.mapping?.sendsOnFader?.busIndex)
        ? data.config.mapping.sendsOnFader.busIndex
        : 1,
    },
    buttonAssignments: normalizeButtonAssignments(data.config?.mapping?.buttonAssignments),
    selectedButton: "f1",
    lcd: normalizeLcdConfig(data.lcd ?? data.config?.lcd),
    lcdSearch: "",
    channels: Array.isArray(data.channels) ? [...data.channels].sort((a, b) => a.index - b.index) : [],
    channelByName: new Map((data.channels ?? []).map((channel) => [channel.index, channel.name])),
    buses: Array.isArray(data.buses) ? [...data.buses] : [],
    busByName: new Map(
      (data.buses ?? []).map((bus) => [busStorageKey(bus.type, bus.index), bus.name]),
    ),
    monitors: Array.isArray(data.monitors) ? [...data.monitors].sort((a, b) => a.index - b.index) : [],
    preview: data.preview ?? null,
    bankOffset: data.preview?.bankOffset ?? 0,
    dirty: false,
    saving: false,
    findingRoles: new Set(),
    discoverError: null,
    loading: false,
    ledOn: Object.fromEntries(SURFACE_ROLES.map((role) => [role, new Set()])),
  };

  const layout = data.layout ?? {};
  const sourceDevices = Array.isArray(data.devices) ? data.devices : [];
  const layoutOrder = Array.isArray(layout.order)
    ? layout.order.filter((role) => typeof role === "string")
    : [];
  const roles = [];
  for (const role of layoutOrder) {
    if (!roles.includes(role)) roles.push(role);
  }
  for (const device of sourceDevices) {
    if (typeof device?.role === "string" && !roles.includes(device.role)) roles.push(device.role);
  }
  if (roles.length === 0) roles.push(...SURFACE_ROLES);

  state.order = roles;
  state.surfaces = {};
  state.devices = {};
  state.ledOn = Object.fromEntries(roles.map((role) => [role, new Set()]));

  for (const role of roles) {
    const source = layout.surfaces?.[role];
    const mode = source?.mode === "fixed" ? "fixed" : "banking";
    const rawTargets = Array.isArray(source?.fixedTargets)
      ? source.fixedTargets
      : Array.isArray(source?.fixedChannels)
        ? source.fixedChannels
        : [];
    const fixedTargets = rawTargets.slice(0, STRIPS_PER_SURFACE).map((entry) => normalizeFixedTarget(entry));
    while (fixedTargets.length < STRIPS_PER_SURFACE) fixedTargets.push(null);
    state.surfaces[role] = { mode, fixedTargets };

    const device = sourceDevices.find((entry) => entry.role === role);
    const fallback = defaultDevice(role);
    state.devices[role] = {
      name: typeof device?.name === "string" ? device.name : null,
      kind: device?.kind === "main" ? "main" : device?.kind === "extender" ? "extender" : fallback.kind,
      enabled: device ? device.enabled !== false : true,
      transport: device?.transport === "network" ? "network" : "usb",
      input: device?.input?.name ? cloneSelector(device.input) : fallback.input,
      output: device?.output?.name ? cloneSelector(device.output) : fallback.output,
      network: {
        host: typeof device?.network?.host === "string" ? device.network.host : "",
        port: Number.isInteger(device?.network?.port) ? device.network.port : DEFAULT_NETWORK_PORT,
      },
      encoder: device?.encoder === "pan" ? "pan" : "off",
      meters: Boolean(device?.meters),
      mainDisplay: normalizeMainDisplay(device?.mainDisplay),
    };
  }

  if (!state.order.some((role) => state.devices[role].kind === "main")) {
    state.devices[state.order[0]].kind = "main";
  }

  dom.fairlightHost.value = state.fairlight.host;
  dom.fairlightPort.value = String(state.fairlight.port);
  dom.modeBadge.hidden = !state.demo;
  dom.singleChannelNotice.hidden = !(state.config?.mapping?.singleChannel != null);
  if (state.demo) dom.modeBadge.textContent = "Demo";
  markClean();
}

async function loadState() {
  try {
    const data = await api("/api/state");
    applyState(data);
    dialogContext = null;
    if (dom.channelDialog.open) dom.channelDialog.close();
    dom.lcdSearch.value = "";
    renderLcdSettings();
    renderDevices();
    renderAppPanel();
    renderSafetyFields();
    if (dom.deviceDialog.open) dom.deviceDialog.close();
    updateStatus();
    updateOnAirBadge();
    startOnAirPolling();
    startAppStatusPolling();
    setDiscoverMessage("");
    if (state.demo) startDemoPolling();
  } catch (error) {
    state.loading = false;
    dom.fairlightPill.dataset.state = "error";
    dom.fairlightStatus.textContent = "Einstellungsseite nicht erreichbar";
    showToast(error.message, "error", 8000);
  }
}

function createCard(role) {
  const title = rolePlaceholder(role);
  const subtitle = roleSubtitle(role);
  const main = isMainRole(role);
  const card = document.createElement("article");
  card.className = "device-card";
  card.dataset.role = role;
  card.dataset.demo = String(state.demo);
  card.innerHTML = `
    <div class="card-head">
      <span class="drag-handle" draggable="true" role="button" tabindex="0" aria-label="${title} verschieben" title="Ziehen oder mit den Pfeiltasten verschieben">
        <svg viewBox="0 0 12 18" aria-hidden="true">
          <circle cx="3.5" cy="4" r="1.3"></circle><circle cx="8.5" cy="4" r="1.3"></circle>
          <circle cx="3.5" cy="9" r="1.3"></circle><circle cx="8.5" cy="9" r="1.3"></circle>
          <circle cx="3.5" cy="14" r="1.3"></circle><circle cx="8.5" cy="14" r="1.3"></circle>
        </svg>
      </span>
      <span class="order-index" data-ref="order">01</span>
      <div class="card-title">
        <h3 data-ref="title" translate="no">${title}</h3>
        <p data-ref="subtitle">${subtitle}</p>
        <input class="device-name-input" data-ref="nameInput" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="${title}" aria-label="Eigener Name für ${title}" hidden />
      </div>
      <button type="button" class="icon-btn rename-btn" data-ref="rename" aria-label="${title} umbenennen" title="Eigener Name" aria-expanded="false">
        <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5 16.5 6.5 7 16H4v-3l9.5-9.5Z"></path></svg>
      </button>
      <button type="button" class="icon-btn remove-btn" data-ref="remove" aria-label="${title} entfernen" title="Gerät entfernen">
        <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"></path></svg>
      </button>
      <div class="card-move">
        <button type="button" class="icon-btn" data-move="-1" aria-label="${title} nach links verschieben">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"></path></svg>
        </button>
        <button type="button" class="icon-btn" data-move="1" aria-label="${title} nach rechts verschieben">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"></path></svg>
        </button>
      </div>
    </div>
    <div class="card-controls">
      <div class="segmented" role="group" aria-label="Kanalmodus für ${title}">
        <button type="button" data-mode="fixed" aria-pressed="false">Fest</button>
        <button type="button" data-mode="banking" aria-pressed="false">Banking</button>
      </div>
      <span class="mode-caption">${main ? "Bank-Tasten am Gerät" : "Fader folgen der Bank"}</span>
    </div>
    <div class="card-behaviour">
      <label class="field field-inline"><span>Encoder</span>
        <select data-ref="encoder">
          <option value="off">Aus</option>
          <option value="pan">Pan</option>
        </select>
      </label>
      <label class="check-row"><input type="checkbox" data-ref="meters"> Pegelanzeigen</label>
    </div>
    <details class="midi-details">
      <summary>
        <span class="port-pip" data-ref="pip"></span>
        <span class="summary-label">Anschluss</span>
        <span class="summary-value" data-ref="summary">Ports</span>
      </summary>
      <div class="midi-grid">
        <div class="transport-row">
          <span class="summary-label">Verbindung</span>
          <div class="segmented" role="group" aria-label="Anschluss für ${title}">
            <button type="button" data-transport="usb" aria-pressed="false">USB</button>
            <button type="button" data-transport="network" aria-pressed="false">Netzwerk</button>
          </div>
        </div>
        <div class="transport-panel" data-panel="usb">
          <label class="field"><span>Eingang</span><select data-port="input"></select></label>
          <label class="field"><span>Ausgang</span><select data-port="output"></select></label>
          <p class="port-status port-detail" data-ref="inputStatus"></p>
          <p class="port-status port-detail" data-ref="outputStatus"></p>
        </div>
        <div class="transport-panel" data-panel="network" hidden>
          <label class="field"><span>IPv4-Adresse</span><input data-network="host" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="192.168.1.29" /></label>
          <label class="field field-narrow"><span>RTP-Port</span><input data-network="port" type="number" inputmode="numeric" min="1" max="65535" /></label>
          <button type="button" class="btn btn-ghost network-test" data-network-test>Verbindung testen</button>
          <p class="port-status" data-ref="networkStatus"></p>
          <p class="port-status network-hint" data-ref="networkHint">Am Gerät: SELECT (CH1) beim Einschalten halten, Drehregler 2 auf NETWORK. Standardport 5004.</p>
        </div>
        <label class="check-row"><input type="checkbox" data-ref="enabled"> Gerät aktiv</label>
        <p class="port-status" data-ref="portStatus"></p>
      </div>
    </details>
    <div class="device-surface">
      <div class="surface-topline">
        <span class="surface-brand">BEHRINGER · ${main ? "X-TOUCH" : "X-TOUCH EXTENDER"}</span>
        <span class="surface-actions">
          <button type="button" class="surface-btn" data-ref="find" title="SELECT-LEDs blinken lassen">
            <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.6 5.6l2 2M12.4 12.4l2 2M14.4 5.6l-2 2M7.6 12.4l-2 2"/></svg>
            Finden
          </button>
          <button type="button" class="surface-btn" data-ref="gear" title="Gerät bearbeiten">
            <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 7.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"/><path d="M8.6 2.6h2.8l.5 2 1.7.7 1.8-1 2 2-1 1.8.7 1.7 2 .5v2.8l-2 .5-.7 1.7 1 1.8-2 2-1.8-1-1.7.7-.5 2H8.6l-.5-2-1.7-.7-1.8 1-2-2 1-1.8-.7-1.7-2-.5v-2.8l2-.5.7-1.7-1-1.8 2-2 1.8 1 1.7-.7.5-2Z"/></svg>
            Bearbeiten
          </button>
        </span>
      </div>
      <div class="device-mini" data-ref="mini" aria-hidden="true"></div>
    </div>
    <p class="card-note" data-ref="note"></p>
  `;

  const refs = {
    card,
    order: card.querySelector('[data-ref="order"]'),
    title: card.querySelector('[data-ref="title"]'),
    subtitle: card.querySelector('[data-ref="subtitle"]'),
    nameInput: card.querySelector('[data-ref="nameInput"]'),
    rename: card.querySelector('[data-ref="rename"]'),
    remove: card.querySelector('[data-ref="remove"]'),
    encoder: card.querySelector('[data-ref="encoder"]'),
    meters: card.querySelector('[data-ref="meters"]'),
    summary: card.querySelector('[data-ref="summary"]'),
    pip: card.querySelector('[data-ref="pip"]'),
    enabled: card.querySelector('[data-ref="enabled"]'),
    portStatus: card.querySelector('[data-ref="portStatus"]'),
    find: card.querySelector('[data-ref="find"]'),
    gear: card.querySelector('[data-ref="gear"]'),
    mini: card.querySelector('[data-ref="mini"]'),
    note: card.querySelector('[data-ref="note"]'),
    input: card.querySelector('[data-port="input"]'),
    output: card.querySelector('[data-port="output"]'),
    inputStatus: card.querySelector('[data-ref="inputStatus"]'),
    outputStatus: card.querySelector('[data-ref="outputStatus"]'),
    transportButtons: [...card.querySelectorAll("[data-transport]")],
    panels: {
      usb: card.querySelector('[data-panel="usb"]'),
      network: card.querySelector('[data-panel="network"]'),
    },
    networkHost: card.querySelector('[data-network="host"]'),
    networkPort: card.querySelector('[data-network="port"]'),
    networkTest: card.querySelector("[data-network-test]"),
    networkStatus: card.querySelector('[data-ref="networkStatus"]'),
    networkHint: card.querySelector('[data-ref="networkHint"]'),
  };
  cardRefs.set(role, refs);

  fillPortSelect(refs.input, state.midi.inputs, state.devices[role].input);
  fillPortSelect(refs.output, state.midi.outputs, state.devices[role].output);

  for (const button of card.querySelectorAll("[data-move]")) {
    button.addEventListener("click", () => moveRole(role, Number(button.dataset.move)));
  }
  refs.remove.addEventListener("click", () => removeDevice(role));
  wireNameEditor(role, refs);
  for (const button of card.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(role, button.dataset.mode));
  }
  refs.encoder.addEventListener("change", () => {
    state.devices[role].encoder = refs.encoder.value === "pan" ? "pan" : "off";
    markDirty();
  });
  refs.meters.addEventListener("change", () => {
    state.devices[role].meters = refs.meters.checked;
    markDirty();
  });
  for (const button of refs.transportButtons) {
    button.addEventListener("click", () => setTransport(role, button.dataset.transport));
  }
  refs.enabled.addEventListener("change", () => {
    state.devices[role].enabled = refs.enabled.checked;
    state.bankOffset = 0;
    markDirty();
    updateCard(role);
    schedulePreview();
  });
  refs.input.addEventListener("change", () => {
    const selector = parsePortValue(refs.input.value);
    if (!selector) return;
    state.devices[role].input = selector;
    markDirty();
    updateCard(role);
  });
  refs.output.addEventListener("change", () => {
    const selector = parsePortValue(refs.output.value);
    if (!selector) return;
    state.devices[role].output = selector;
    markDirty();
    updateCard(role);
  });
  refs.networkHost.addEventListener("input", () => {
    state.devices[role].network.host = refs.networkHost.value;
    markDirty();
  });
  refs.networkPort.addEventListener("input", () => {
    const port = Number(refs.networkPort.value);
    state.devices[role].network.port = Number.isInteger(port) && port > 0 ? port : DEFAULT_NETWORK_PORT;
    markDirty();
  });
  refs.networkTest.addEventListener("click", () => {
    void testNetworkDevice(role);
  });
  refs.find.addEventListener("click", () => {
    void findDevice(role);
  });
  refs.gear.addEventListener("click", () => {
    openDeviceDialog(role, refs.gear);
  });

  wireDrag(role, card, card.querySelector(".drag-handle"));
  return card;
}

function wireNameEditor(role, refs) {
  let previousName = null;

  const openEditor = () => {
    previousName = state.devices[role].name;
    refs.nameInput.value = previousName ?? "";
    refs.nameInput.hidden = false;
    refs.rename.setAttribute("aria-expanded", "true");
    refs.nameInput.focus();
    refs.nameInput.select();
  };

  const closeEditor = (commit) => {
    if (refs.nameInput.hidden) return;
    if (commit) {
      const value = refs.nameInput.value.trim();
      state.devices[role].name = value === "" ? null : value;
      if (state.devices[role].name !== previousName) markDirty();
    } else {
      state.devices[role].name = previousName;
    }
    refs.nameInput.hidden = true;
    refs.rename.setAttribute("aria-expanded", "false");
    updateCard(role);
  };

  refs.rename.addEventListener("mousedown", (event) => event.preventDefault());
  refs.rename.addEventListener("click", () => {
    if (refs.nameInput.hidden) openEditor();
    else closeEditor(true);
  });
  refs.nameInput.addEventListener("input", () => {
    const value = refs.nameInput.value.trim();
    state.devices[role].name = value === "" ? null : value;
    markDirty();
    updateCard(role);
  });
  refs.nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor(false);
    }
  });
  refs.nameInput.addEventListener("blur", () => closeEditor(true));
}

function fillPortSelect(select, ports, selector) {
  const entries = describePorts(ports);
  select.replaceChildren();
  const values = new Set();
  const selectable = entries.find(
    (port) => port.name === selector?.name && port.occurrence === selector?.occurrence,
  );
  if (selector?.name && !selectable) {
    const option = document.createElement("option");
    option.value = selectorKey(selector);
    option.textContent = `${selector.name} · #${selector.occurrence + 1} · nicht gefunden`;
    option.disabled = true;
    select.append(option);
    values.add(option.value);
  }
  for (const port of entries) {
    const option = document.createElement("option");
    option.value = selectorKey({ name: port.name, occurrence: port.occurrence });
    option.textContent = portLabel(port);
    select.append(option);
    values.add(option.value);
  }
  if (entries.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Keine MIDI-Ports gefunden";
    option.disabled = true;
    select.append(option);
  }
  const desired = selector?.name ? selectorKey(selector) : "";
  if (desired && values.has(desired)) select.value = desired;
  else if (entries.length > 0) select.value = selectorKey({ name: entries[0].name, occurrence: entries[0].occurrence });
}

function parsePortValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.name === "string" && Number.isInteger(parsed.occurrence)) {
      return { name: parsed.name, occurrence: parsed.occurrence };
    }
  } catch {
    return null;
  }
  return null;
}

function fillLcdLineSelect(select, selected) {
  select.replaceChildren();
  for (const [value, label] of Object.entries(LCD_LINE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = selected;
}

function renderLcdPalette() {
  dom.lcdPalette.replaceChildren();
  for (const key of LCD_PALETTE_KEYS) {
    const row = document.createElement("div");
    row.className = "lcd-palette-row";
    const labelWrap = document.createElement("span");
    labelWrap.className = "lcd-palette-label";
    const dot = document.createElement("span");
    dot.className = "lcd-dot";
    dot.style.background = colorDotStyle(state.lcd.palette[key]);
    const label = document.createElement("span");
    label.textContent = LCD_PALETTE_LABELS[key];
    labelWrap.append(dot, label);
    const select = document.createElement("select");
    select.className = "lcd-select";
    select.setAttribute("aria-label", `Farbe für ${LCD_PALETTE_LABELS[key]}`);
    for (const color of LCD_COLORS) {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = LCD_COLOR_LABELS[color];
      select.append(option);
    }
    select.value = state.lcd.palette[key];
    select.addEventListener("change", () => {
      state.lcd.palette[key] = normalizeLcdColor(select.value, "off");
      dot.style.background = colorDotStyle(state.lcd.palette[key]);
      markDirty();
      updateAllCards();
      schedulePreview();
    });
    row.append(labelWrap, select);
    dom.lcdPalette.append(row);
  }
}

function createLcdColorSelect(current) {
  const select = document.createElement("select");
  select.className = "lcd-select";
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Automatisch";
  select.append(auto);
  for (const color of LCD_COLORS) {
    const option = document.createElement("option");
    option.value = color;
    option.textContent = LCD_COLOR_LABELS[color];
    select.append(option);
  }
  select.value = current;
  return select;
}

function createLcdRow(target, name, guardName = name) {
  const key = lcdTargetStorageKey(target);
  const row = document.createElement("div");
  row.className = "lcd-row";
  row.dataset.key = key;

  const targetCell = document.createElement("span");
  targetCell.className = "lcd-target";
  const type = document.createElement("span");
  type.className = "lcd-target-type";
  type.textContent = lcdTargetLabel(target);
  const targetName = document.createElement("span");
  targetName.className = "lcd-target-name";
  targetName.setAttribute("translate", "no");
  targetName.textContent = name;
  targetCell.append(type, targetName);

  const short = document.createElement("input");
  short.type = "text";
  short.className = "lcd-short";
  short.maxLength = 7;
  short.placeholder = "Kurzname";
  short.autocomplete = "off";
  short.spellcheck = false;
  short.setAttribute("aria-label", `LCD-Kurzname für ${lcdTargetLabel(target)} ${name}`);

  const colorSelect = createLcdColorSelect(state.lcd.overrides.get(key)?.color ?? "auto");
  colorSelect.setAttribute("aria-label", `LCD-Farbe für ${lcdTargetLabel(target)} ${name}`);

  const status = document.createElement("span");
  status.className = "lcd-status";

  const rebind = document.createElement("button");
  rebind.type = "button";
  rebind.className = "btn btn-ghost lcd-rebind";
  rebind.textContent = "Aktualisieren";
  rebind.hidden = true;

  const currentOverride = () => state.lcd.overrides.get(key);
  const refresh = () => {
    const entry = currentOverride();
    const paused = Boolean(guardName && entry?.expectedName && entry.expectedName.trim() !== guardName.trim());
    short.value = entry?.name ?? "";
    colorSelect.value = entry?.color ?? "auto";
    rebind.hidden = !paused;
    if (paused) {
      status.textContent = `Name in Fairlight geändert. Ausnahme pausiert bis „Aktualisieren“.`;
      status.hidden = false;
      status.dataset.tone = "warn";
    } else if (entry) {
      const description = entry.color !== "auto" ? LCD_COLOR_LABELS[entry.color] : "Typfarbe";
      status.textContent = `Aktiv · ${description}`;
      status.hidden = false;
      status.dataset.tone = "active";
    } else {
      status.textContent = "";
      status.hidden = true;
      delete status.dataset.tone;
    }
    row.style.setProperty(
      "--lcd-row-color",
      colorDotStyle(effectiveLcdColor(target, paused ? undefined : entry)),
    );
  };

  const editOverride = (mutate) => {
    let entry = currentOverride();
    if (!entry) {
      entry = { target, color: "auto", name: null, expectedName: guardName?.trim() || null };
      state.lcd.overrides.set(key, entry);
    }
    mutate(entry);
    entry.expectedName = guardName?.trim() || null;
    if (entry.color === "auto" && entry.name === null) state.lcd.overrides.delete(key);
    markDirty();
    refresh();
    updateLcdSummary();
    updateAllCards();
    schedulePreview();
  };

  short.addEventListener("input", () => {
    const value = short.value.slice(0, 7);
    if (short.value !== value) short.value = value;
    editOverride((entry) => {
      const trimmed = value.trim();
      entry.name = trimmed === "" ? null : trimmed;
    });
  });
  colorSelect.addEventListener("change", () => {
    editOverride((entry) => {
      entry.color = colorSelect.value === "auto" ? "auto" : normalizeLcdColor(colorSelect.value, "auto");
    });
  });
  rebind.addEventListener("click", () => {
    const entry = currentOverride();
    if (!entry) return;
    entry.expectedName = guardName?.trim() || null;
    markDirty();
    refresh();
    updateLcdSummary();
    updateAllCards();
    schedulePreview();
  });

  row.style.setProperty("--lcd-row-color", colorDotStyle(effectiveLcdColor(target, currentOverride())));
  row.append(targetCell, short, colorSelect, rebind, status);
  refresh();
  return row;
}

function renderLcdOverrideList() {
  dom.lcdOverrideList.replaceChildren();
  const query = state.lcdSearch.trim().toLowerCase();
  const allTargets = lcdTargets();
  const visible = allTargets.filter(({ target, name }) => {
    if (query === "") return true;
    return (
      name.toLowerCase().includes(query) ||
      lcdTargetLabel(target).toLowerCase().includes(query) ||
      String(target.kind === "channel" ? target.channel : target.index) === query
    );
  });
  const known = new Set(allTargets.map(({ target }) => lcdTargetStorageKey(target)));
  const orphans = [...state.lcd.overrides.entries()]
    .filter(([key]) => !known.has(key))
    .map(([, entry]) => ({ target: entry.target, name: "Nicht in Fairlight gefunden" }))
    .filter(({ target, name }) => {
      if (query === "") return true;
      return name.toLowerCase().includes(query) || lcdTargetLabel(target).toLowerCase().includes(query);
    });
  if (visible.length === 0 && orphans.length === 0) {
    const empty = document.createElement("div");
    empty.className = "channel-empty";
    const strong = document.createElement("strong");
    strong.textContent = state.channels.length === 0 && state.buses.length === 0 ? "Keine Ziele geladen" : "Kein Treffer";
    const text = document.createElement("span");
    text.textContent =
      state.channels.length === 0 && state.buses.length === 0
        ? "Eingänge und Busse zuerst über Fairlight einlesen."
        : "Andere Suche versuchen.";
    empty.append(strong, text);
    dom.lcdOverrideList.append(empty);
    return;
  }
  for (const { target, name } of visible) {
    dom.lcdOverrideList.append(createLcdRow(target, name));
  }
  for (const { target, name } of orphans) {
    dom.lcdOverrideList.append(createLcdRow(target, name, null));
  }
}

function updateLcdSummary() {
  const count = state.lcd.overrides.size;
  dom.lcdSummary.textContent = state.lcd.colorsEnabled
    ? `Farben aktiv · ${count} Ausnahme${count === 1 ? "" : "n"}`
    : "Farben aus";
  dom.lcdSummary.dataset.tone = state.lcd.colorsEnabled ? "active" : "";
}

function renderLcdSettings() {
  dom.lcdEnabled.checked = state.lcd.colorsEnabled;
  fillLcdLineSelect(dom.lcdLine1, state.lcd.line1);
  fillLcdLineSelect(dom.lcdLine2, state.lcd.line2);
  renderLcdPalette();
  renderLcdOverrideList();
  updateLcdSummary();
}

function resetLcdPalette() {
  state.lcd.palette = { ...DEFAULT_LCD_PALETTE };
  state.lcd.colorsEnabled = true;
  markDirty();
  renderLcdSettings();
  updateAllCards();
  schedulePreview();
  showToast("Typfarben zurückgesetzt. Ausnahmen bleiben erhalten.", "info");
}

const BUTTON_LABELS = {
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  track: "TRACK",
  eq: "EQ",
  plugin: "PLUG-IN",
  instrument: "INST",
  "global-view": "GLOBAL VIEW",
  "midi-tracks": "MIDI TRKS",
  inputs: "INPUTS",
  "audio-tracks": "AUDIO TRKS",
  "audio-instruments": "AUDIO INST",
  aux: "AUX",
  buses: "BUSES",
  outputs: "OUTPUTS",
  user: "USER",
  "name-value": "NAME/VALUE",
  "smpte-beats": "SMPTE/BEATS",
  "read-off": "READ/OFF",
  write: "WRITE",
  trim: "TRIM",
  touch: "TOUCH",
  latch: "LATCH",
  group: "GROUP",
  save: "SAVE",
  undo: "UNDO",
  cancel: "CANCEL",
  enter: "ENTER",
  marker: "MARKER",
  nudge: "NUDGE",
  cycle: "CYCLE",
  drop: "DROP",
  replace: "REPLACE",
  click: "CLICK",
  "rude-solo": "SOLO",
  rewind: "◀◀",
  forward: "▶▶",
  stop: "■",
  play: "▶",
  record: "●",
  "nav-up": "▲",
  "nav-down": "▼",
  "nav-left": "◀",
  "nav-right": "▶",
  scrub: "SCRUB",
};
const BUTTON_IDS = Object.keys(BUTTON_LABELS);
const FUNCTION_BUTTONS = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];
const BUTTON_NAMES = {
  rewind: "REWIND",
  forward: "FORWARD",
  stop: "STOP",
  play: "PLAY",
  record: "RECORD",
  "nav-up": "UP",
  "nav-down": "DOWN",
  "nav-left": "LEFT",
  "nav-right": "RIGHT",
  "rude-solo": "SOLO",
};

function buttonLabel(id) {
  return BUTTON_LABELS[id] ?? String(id ?? "").toUpperCase();
}

function buttonName(id) {
  return BUTTON_NAMES[id] ?? buttonLabel(id);
}

function assignmentSummary(assignment) {
  if (!assignment) return "Nicht belegt";
  return assignment.type === "monitor-dim"
    ? `Monitor-Dim · Monitor ${assignment.monitorIndex}`
    : `Sends on Fader · Aux ${assignment.auxIndex}`;
}

function normalizeButtonAssignments(source) {
  const assignments = {};
  if (!source || typeof source !== "object") return assignments;
  for (const button of BUTTON_IDS) {
    const entry = source[button];
    if (!entry) continue;
    if (entry.type === "sends-on-fader") {
      const auxIndex = Number(entry.auxIndex);
      if (!Number.isInteger(auxIndex) || auxIndex < 1) continue;
      assignments[button] = { type: "sends-on-fader", auxIndex };
    } else if (entry.type === "monitor-dim") {
      const monitorIndex = Number(entry.monitorIndex);
      if (!Number.isInteger(monitorIndex) || monitorIndex < 1) continue;
      assignments[button] = { type: "monitor-dim", monitorIndex };
    }
  }
  return assignments;
}

function auxBusOptions(selected) {
  const auxes = state.buses
    .filter((bus) => bus.type === "aux")
    .slice()
    .sort((a, b) => a.index - b.index);
  const options = auxes.map((bus) => ({ index: bus.index, label: `Aux ${bus.index} · ${bus.name}` }));
  if (!auxes.some((bus) => bus.index === selected)) {
    options.push({ index: selected, label: `Aux ${selected} (nicht erkannt)` });
  }
  return options;
}

function fillAuxSelect(select, selected) {
  select.replaceChildren();
  for (const option of auxBusOptions(selected)) {
    const element = document.createElement("option");
    element.value = String(option.index);
    element.textContent = option.label;
    select.append(element);
  }
  select.value = String(selected);
}

function monitorOptions(selected) {
  const monitors = state.monitors.slice().sort((a, b) => a.index - b.index);
  const options = monitors.map((monitor) => ({ index: monitor.index, label: `Monitor ${monitor.index} · ${monitor.name}` }));
  if (!monitors.some((monitor) => monitor.index === selected)) {
    options.push({ index: selected, label: `Monitor ${selected} (nicht erkannt)` });
  }
  return options;
}

function fillMonitorSelect(select, selected) {
  select.replaceChildren();
  for (const option of monitorOptions(selected)) {
    const element = document.createElement("option");
    element.value = String(option.index);
    element.textContent = option.label;
    select.append(element);
  }
  select.value = String(selected);
}

const SEGMENT_DIGITS = 10;

function blankSegmentCells() {
  return Array.from({ length: SEGMENT_DIGITS }, () => ({ character: " ", dot: false }));
}

function segmentCellsFromText(text) {
  const cells = [];
  for (const character of text) {
    if (character === ".") {
      const previous = cells[cells.length - 1];
      if (previous) previous.dot = true;
      continue;
    }
    cells.push({ character, dot: false });
  }
  if (cells.length > SEGMENT_DIGITS) cells.splice(0, cells.length - SEGMENT_DIGITS);
  while (cells.length < SEGMENT_DIGITS) cells.unshift({ character: " ", dot: false });
  return cells;
}

function pad2(value) {
  return String(Math.abs(Math.trunc(value)) % 100).padStart(2, "0");
}

function clockSegmentCells() {
  const now = new Date();
  const cells = blankSegmentCells();
  const place = (start, text) => {
    Array.from(text).forEach((character, index) => {
      const cell = cells[start + index];
      if (cell) cell.character = character;
    });
  };
  place(1, pad2(now.getHours()));
  place(3, pad2(now.getMinutes()));
  place(5, pad2(now.getSeconds()));
  cells[4].dot = true;
  cells[6].dot = true;
  return cells;
}

function previewVisibleChannels(role, scope) {
  const roles = scope === "main" ? [role] : state.order;
  const channels = [];
  for (const candidate of roles) {
    const surface = previewFor(candidate);
    if (!surface) continue;
    for (const strip of surface.strips) {
      const target = strip.target;
      if (target?.kind === "channel" && Number.isInteger(target.channel)) channels.push(target.channel);
    }
  }
  return channels;
}

function channelSegmentCells(channels) {
  if (channels.length === 0) return null;
  const first = channels[0];
  const last = channels[channels.length - 1];
  const contiguous = channels.every((channel, index) => index === 0 || channel === channels[index - 1] + 1);
  return segmentCellsFromText(contiguous && channels.length > 1 ? `${first}  ${last}` : String(first));
}

/**
 * Seven-segment preview: renders the cells the bridge would write, in the
 * physical 3-2-2-3 grouping, with real segment glyphs. It shows the intended
 * bytes, not verified device output; letters without a clean 7-segment form
 * use the usual approximations (N as lower-case n, R as r).
 */
const SEG7_WIDTH = 19;
const SEG7_HEIGHT = 34;
const SEG7_THICK = 4;
const SEG7_SCREEN = { x: 904, y: 159, width: 340, height: 52 };
const SEG7_GROUPS = [3, 2, 2, 3];

const SEG7_GLYPHS = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgcde",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  " ": "",
  "-": "g",
  A: "abcefg",
  b: "cdefg",
  C: "adef",
  d: "bcdeg",
  E: "adefg",
  F: "aefg",
  G: "acdef",
  H: "bcefg",
  I: "bc",
  J: "bcd",
  L: "def",
  n: "ceg",
  O: "abcdef",
  o: "cdeg",
  P: "abefg",
  r: "eg",
  S: "acdfg",
  t: "defg",
  U: "bcdef",
  y: "bcdfg",
};
const SEG7_ALIASES = { B: "b", D: "d", N: "n", R: "r" };

function segmentGlyph(character) {
  const direct = SEG7_GLYPHS[character];
  if (direct !== undefined) return direct;
  const alias = SEG7_ALIASES[character];
  return alias === undefined ? "" : SEG7_GLYPHS[alias] ?? "";
}

function seg7Xs() {
  const digitCount = SEG7_GROUPS.reduce((sum, count) => sum + count, 0);
  // Inner gaps run within every group; between groups the leftover inner gap
  // adds to the wider group gap.
  const total =
    digitCount * SEG7_WIDTH +
    (digitCount - SEG7_GROUPS.length) * 3 +
    (SEG7_GROUPS.length - 1) * (3 + 9);
  const xs = [];
  let x = SEG7_SCREEN.x + (SEG7_SCREEN.width - total) / 2;
  for (const [groupIndex, count] of SEG7_GROUPS.entries()) {
    if (groupIndex > 0) x += 9;
    for (let index = 0; index < count; index += 1) {
      xs.push(x);
      x += SEG7_WIDTH + 3;
    }
  }
  return xs;
}

function seg7Shapes(x, y) {
  const w = SEG7_WIDTH;
  const h = SEG7_HEIGHT;
  const t = SEG7_THICK;
  const mid = h / 2 - t / 2;
  const vTop = t * 0.75;
  const vLen = mid - t * 0.75 - 0.5;
  const vBottom = mid + t * 1.25;
  const horizontal = (sy) =>
    `${x + 1.6},${sy} ${x + w - 1.6},${sy} ${x + w},${sy + t / 2} ${x + w - 1.6},${sy + t} ${x + 1.6},${sy + t} ${x},${sy + t / 2}`;
  const vertical = (sx, sy) =>
    `${sx},${sy + 1.6} ${sx + t / 2},${sy} ${sx + t},${sy + 1.6} ${sx + t},${sy + vLen - 1.6} ${sx + t / 2},${sy + vLen} ${sx},${sy + vLen - 1.6}`;
  return {
    a: horizontal(y),
    g: horizontal(y + mid),
    d: horizontal(y + h - t),
    f: vertical(x, y + vTop),
    b: vertical(x + w - t, y + vTop),
    e: vertical(x, y + vBottom),
    c: vertical(x + w - t, y + vBottom),
  };
}

function seg7DigitSvg(x, y, cell) {
  const glyph = segmentGlyph(cell.character);
  let markup = "";
  for (const [name, points] of Object.entries(seg7Shapes(x, y))) {
    markup += `<polygon class="deck-seg${glyph.includes(name) ? " is-lit" : ""}" points="${points}"/>`;
  }
  markup += `<circle class="deck-seg-dot${cell.dot ? " is-lit" : ""}" cx="${(x + SEG7_WIDTH - 1.2).toFixed(1)}" cy="${(y + SEG7_HEIGHT + 4.5).toFixed(1)}" r="2.4"/>`;
  return `<g>${markup}</g>`;
}

function segmentDisplayMarkup(role) {
  const display = state.devices[role]?.mainDisplay ?? { mode: "off", scope: "surface" };
  const cells = mainDisplayCellsFor(role, display) ?? blankSegmentCells();
  const y = SEG7_SCREEN.y + (SEG7_SCREEN.height - SEG7_HEIGHT) / 2;
  const xs = seg7Xs();
  return cells.map((cell, index) => seg7DigitSvg(xs[index], y, cell)).join("");
}

function refreshSegmentDisplays() {
  for (const group of document.querySelectorAll("[data-segment-display]")) {
    group.innerHTML = segmentDisplayMarkup(group.dataset.segmentDisplay);
  }
}

function stopSegmentClock() {
  if (segmentClockTimer) {
    window.clearInterval(segmentClockTimer);
    segmentClockTimer = null;
  }
}

function ensureSegmentClock() {
  const role = state.dialogRole;
  const mode = role ? state.devices[role]?.mainDisplay?.mode : "off";
  if (mode !== "clock") {
    stopSegmentClock();
    return;
  }
  if (segmentClockTimer) return;
  segmentClockTimer = window.setInterval(refreshSegmentDisplays, 1000);
}

function meterTargetLabel(target) {
  const bus = state.buses.find((entry) => entry.type === target.busType && entry.index === target.index);
  const type = (BUS_LABELS[target.busType] ?? target.busType).toUpperCase();
  return bus ? `${type} ${target.index} · ${bus.name}` : `${type} ${target.index}`;
}

function meterDisplayValue(meter) {
  const bus = state.buses.find(
    (entry) => entry.type === meter.target.busType && entry.index === meter.target.index,
  );
  const raw = meter.measurement === "loudness" ? bus?.integratedLufs : bus?.meterDb;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return meter.measurement === "headroom" ? Math.min(99.9, Math.max(0, -raw)) : raw;
  }
  // Example value so the preview can show the intended formatting.
  return meter.measurement === "headroom" ? 6 : -23.1;
}

function mainDisplayCellsFor(role, display) {
  switch (display.mode) {
    case "off":
      return null;
    case "clock":
      return clockSegmentCells();
    case "meter":
      return display.meter ? segmentCellsFromText(meterDisplayValue(display.meter).toFixed(1)) : null;
    case "on-air": {
      const value = dialogOnAirSim === null ? state.onAir : dialogOnAirSim;
      return typeof value === "boolean" ? segmentCellsFromText(value ? "ON AIR" : "OFF AIR") : null;
    }
    case "auto":
      if (dialogSendActive && state.sendsOnFader.enabled) {
        return segmentCellsFromText(String(state.sendsOnFader.busIndex ?? 1).padStart(2, "0"));
      }
      break;
    default:
      break;
  }
  return channelSegmentCells(previewVisibleChannels(role, display.scope));
}

function mainDisplayHint(display) {
  switch (display.mode) {
    case "off":
      return "Die Bridge lässt die Anzeige unverändert.";
    case "clock":
      return "Lokale Uhrzeit des Bridge-Rechners. Beispiel, nicht am Gerät geprüft.";
    case "meter":
      return display.meter?.measurement === "headroom"
        ? "Pegelreserve bis 0 dB aus dem Spitzenpegel des gewählten Busses; ohne Messwert zeigt die Vorschau einen Beispielwert."
        : "Integrierte Lautheit des gewählten Main-Busses. Das Minuszeichen ist am Gerät nicht geprüft; die Vorschau zeigt ohne Messwert einen Beispielwert.";
    case "on-air":
      return "Experimentell: Die Lesbarkeit von Wörtern auf 7 Segmenten ist am Gerät nicht geprüft. Unbekannter Status bleibt leer.";
    case "auto":
      return `Im Betrieb: Bankbereich; bei aktivem Sends on Fader Aux ${String(
        state.sendsOnFader.busIndex ?? 1,
      ).padStart(2, "0")}. Ohne Fairlight bleibt sie leer.`;
    default:
      return "Folgt der Bank-Vorschau. Am Gerät nicht geprüft.";
  }
}

function bankSimState() {
  const preview = state.preview;
  if (!preview || preview.bankStep <= 0) return { prev: false, next: false };
  const page = Math.floor(preview.bankOffset / preview.bankStep) + 1;
  return { prev: preview.bankOffset > 0, next: page < preview.bankPages };
}

function simButton(key, label, pressed, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.simKey = key;
  button.textContent = label;
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", onClick);
  return button;
}

function appendBankSim() {
  const wrap = document.createElement("div");
  wrap.className = "segment-sim";
  const limits = bankSimState();
  const prev = document.createElement("button");
  prev.type = "button";
  prev.dataset.simKey = "bank-prev";
  prev.className = "btn btn-ghost";
  prev.textContent = "◀ Bank";
  prev.setAttribute("aria-label", "Vorherige Bank");
  prev.disabled = !limits.prev;
  prev.addEventListener("click", () => moveBank(-1));
  const next = document.createElement("button");
  next.type = "button";
  next.dataset.simKey = "bank-next";
  next.className = "btn btn-ghost";
  next.textContent = "Bank ▶";
  next.setAttribute("aria-label", "Nächste Bank");
  next.disabled = !limits.next;
  next.addEventListener("click", () => moveBank(1));
  wrap.append(prev, next);
  dom.mainDisplaySim.append(wrap);
}

function appendMixSim() {
  const wrap = document.createElement("div");
  wrap.className = "segmented sim-segmented";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Sends on Fader simulieren");
  const apply = (active) => {
    dialogSendActive = active;
    const [mainMix, auxMix] = [...wrap.children];
    mainMix?.setAttribute("aria-pressed", String(!active));
    auxMix?.setAttribute("aria-pressed", String(active));
    refreshSegmentDisplays();
  };
  const auxLabel = `Aux ${String(state.sendsOnFader.busIndex ?? 1).padStart(2, "0")}`;
  wrap.append(
    simButton("mix-main", "Main Mix", !dialogSendActive, () => apply(false)),
    simButton("mix-aux", auxLabel, dialogSendActive, () => apply(true)),
  );
  dom.mainDisplaySim.append(wrap);
}

function appendOnAirSim() {
  const wrap = document.createElement("div");
  wrap.className = "segmented sim-segmented";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "On-Air-Zustand simulieren");
  const shown = dialogOnAirSim === null ? state.onAir : dialogOnAirSim;
  const options = [
    { key: "onair-on", label: "On", value: true },
    { key: "onair-off", label: "Off", value: false },
    { key: "onair-unknown", label: "Unbekannt", value: null },
  ];
  for (const option of options) {
    wrap.append(
      simButton(option.key, option.label, option.value === shown, () => {
        dialogOnAirSim = option.value;
        for (const [index, button] of [...wrap.children].entries()) {
          button.setAttribute("aria-pressed", String(options[index]?.value === option.value));
        }
        refreshSegmentDisplays();
      }),
    );
  }
  dom.mainDisplaySim.append(wrap);
}

function meterBusOptions(measurement, meter) {
  const desired = meter ? `${meter.target.busType}:${meter.target.index}` : "";
  const buses = state.buses
    .filter((bus) => measurement !== "loudness" || bus.type === "main")
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index);
  const options = buses.map((bus) => ({
    value: `${bus.type}:${bus.index}`,
    label: `${(BUS_LABELS[bus.type] ?? bus.type).toUpperCase()} ${bus.index} · ${bus.name}`,
  }));
  if (meter && !options.some((option) => option.value === desired)) {
    options.push({ value: desired, label: `${meterTargetLabel(meter.target)} · nicht erkannt` });
  }
  return options;
}

function fillMeterTargetSelect(select, meter) {
  select.replaceChildren();
  for (const option of meterBusOptions(meter?.measurement ?? "loudness", meter)) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = meter ? `${meter.target.busType}:${meter.target.index}` : "";
}

function renderMainDisplayEditor(role) {
  const display = state.devices[role].mainDisplay;
  dom.mainDisplayMode.value = display.mode;
  dom.mainDisplayScope.value = display.scope;
  dom.mainDisplayScopeField.hidden = display.mode !== "channels" && display.mode !== "auto";
  const meterMode = display.mode === "meter";
  dom.mainDisplayMeasurementField.hidden = !meterMode;
  dom.mainDisplayTargetField.hidden = !meterMode;
  if (meterMode) {
    const meter = display.meter ?? {
      measurement: "loudness",
      target: { kind: "bus", busType: "main", index: 1 },
    };
    dom.mainDisplayMeasurement.value = meter.measurement;
    fillMeterTargetSelect(dom.mainDisplayTarget, meter);
  }
  const active = document.activeElement;
  const focusKey =
    active instanceof Element && dom.mainDisplaySim.contains(active) ? active.dataset.simKey : null;
  dom.mainDisplaySim.replaceChildren();
  if (display.mode === "channels" || display.mode === "auto") appendBankSim();
  if (display.mode === "auto" && state.sendsOnFader.enabled) appendMixSim();
  if (display.mode === "on-air") appendOnAirSim();
  if (focusKey) dom.mainDisplaySim.querySelector(`[data-sim-key="${focusKey}"]`)?.focus();
  dom.mainDisplayHint.textContent = mainDisplayHint(display);
  ensureSegmentClock();
}

function renderDialogEditor() {
  const role = state.dialogRole;
  if (!role) return;
  const main = isMainRole(role);
  dom.fkeyEditor.hidden = !main;
  dom.mainDisplayEditor.hidden = !main;
  if (main) renderMainDisplayEditor(role);
  if (main) {
    const selected = state.selectedButton;
    const assignment = state.buttonAssignments[selected] ?? null;
    const type = assignment?.type ?? "";
    dom.selectedButton.textContent = buttonName(selected);
    dom.buttonFunction.value = type;
    dom.buttonAuxField.hidden = type !== "sends-on-fader";
    dom.buttonMonitorField.hidden = type !== "monitor-dim";
    if (type === "sends-on-fader") {
      fillAuxSelect(dom.buttonAux, assignment.auxIndex);
      const auxBus = state.buses.find((bus) => bus.type === "aux" && bus.index === assignment.auxIndex);
      if (auxBus) {
        dom.buttonHint.textContent = `${buttonName(selected)} ruft ${auxBus.name} als Aux-Mix auf. PAN schaltet zurück.`;
      } else {
        dom.buttonHint.textContent = `Aux ${assignment.auxIndex} wurde nicht erkannt. Die Belegung bleibt erhalten, die Taste bleibt wirkungslos.`;
      }
    } else if (type === "monitor-dim") {
      fillMonitorSelect(dom.buttonMonitor, assignment.monitorIndex);
      const monitor = state.monitors.find((entry) => entry.index === assignment.monitorIndex);
      if (!monitor) {
        dom.buttonHint.textContent = `Monitor ${assignment.monitorIndex} wurde nicht erkannt. Die Belegung bleibt erhalten, die Taste bleibt wirkungslos.`;
      } else if (!state.config?.safety?.allowedWriteMonitors?.includes(monitor.index)) {
        dom.buttonHint.textContent = `${buttonName(selected)} schaltet Monitor ${monitor.index} (${monitor.name}) auf Dim, sofern der Monitor in der Schreibfreigabe steht. Die LED folgt Fairlight.`;
      } else {
        dom.buttonHint.textContent = `${buttonName(selected)} schaltet Monitor ${monitor.index} (${monitor.name}) auf Dim. Die LED leuchtet nur bei bestätigtem Dim-Zustand.`;
      }
    } else {
      dom.buttonHint.textContent = "Diese Taste ist nicht belegt. Am Pult wird sie ignoriert.";
    }
  }
  const surface = state.surfaces[role];
  dom.deviceStripHint.textContent =
    surface.mode === "fixed"
      ? "Kanalzug anklicken, um sein festes Ziel zu wählen. Banking, Mute und Touch-Schutz bleiben Standard."
      : "Dieses Gerät folgt dem Banking. Oben am Gerät auf Fest schalten, um Ziele zu wählen.";
}

function openDeviceDialog(role, opener) {
  state.dialogRole = role;
  state.dialogOpener = opener ?? null;
  dialogSendActive = false;
  dialogOnAirSim = null;
  const displayName = state.devices[role]?.name || rolePlaceholder(role);
  dom.deviceDialogTitle.textContent = displayName;
  dom.deviceDialogContext.textContent = isMainRole(role)
    ? "Tasten belegen und bei Festbelegung die Kanalzüge wählen."
    : "X-Touch Extender · bei Festbelegung die Kanalzüge wählen.";
  renderDeviceDialog(role);
  renderDialogEditor();
  dom.deviceDialog.showModal();
  window.setTimeout(() => {
    const focusTarget =
      dom.deviceDialogDeck.querySelector("[data-button]") ??
      dom.deviceDialogDeck.querySelector('.deck-strip[data-strip][role="button"]');
    (focusTarget ?? dom.deviceDialogClose).focus();
  }, 30);
}

function refreshDeviceDialog() {
  if (!state.dialogRole || !dom.deviceDialog.open) return;
  renderDeviceDialog(state.dialogRole);
  renderDialogEditor();
}

function renderDeviceDialog(role) {
  const active = document.activeElement;
  const focusInfo =
    active instanceof Element && dom.deviceDialogDeck.contains(active)
      ? { button: active.dataset.button, strip: active.dataset.strip }
      : null;
  dom.deviceDialogDeck.innerHTML = deviceDeckSvg(role, { uid: `dlg-${role}`, interactive: true });
  for (const element of dom.deviceDialogDeck.querySelectorAll(".deck-strip[data-strip]")) {
    element.addEventListener("click", () => {
      if (state.surfaces[role].mode !== "fixed") return;
      openChannelDialog(role, Number(element.dataset.strip));
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (state.surfaces[role].mode !== "fixed") return;
      openChannelDialog(role, Number(element.dataset.strip));
    });
  }
  for (const element of dom.deviceDialogDeck.querySelectorAll("[data-button]")) {
    element.addEventListener("click", () => {
      state.selectedButton = element.dataset.button;
      renderDeviceDialog(role);
      renderDialogEditor();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedButton = element.dataset.button;
      renderDeviceDialog(role);
      renderDialogEditor();
    });
  }
  if (focusInfo?.button) {
    dom.deviceDialogDeck.querySelector(`[data-button="${focusInfo.button}"]`)?.focus();
  } else if (focusInfo?.strip !== undefined && focusInfo.strip !== undefined) {
    dom.deviceDialogDeck.querySelector(`.deck-strip[data-strip="${focusInfo.strip}"]`)?.focus();
  }
}

function renderDeviceMini(role) {
  const refs = cardRefs.get(role);
  if (!refs) return;
  refs.mini.innerHTML = deviceDeckSvg(role, { uid: `mini-${role}`, interactive: false });
}

function syncDeviceLeds(role) {
  const active = state.ledOn[role] ?? new Set();
  if (state.dialogRole === role) {
    for (const element of dom.deviceDialogDeck.querySelectorAll(".deck-strip[data-strip]")) {
      const led = element.querySelector(".select-led");
      led?.classList.toggle("is-on", active.has(Number(element.dataset.strip)));
    }
  }
}

function lcdClamp(text, max = 7) {
  return Array.from(String(text ?? "")).slice(0, max).join("");
}

function stripViewData(role, index) {
  const preview = previewFor(role);
  const entry = preview?.strips?.find((strip) => strip.strip === index);
  const surface = state.surfaces[role];
  const fixedTarget = surface.mode === "fixed" ? (surface.fixedTargets[index] ?? null) : null;
  const target = entry?.target ?? targetInfo(fixedTarget);
  const lcd = entry?.lcd ?? null;
  const fallbackName = target ? (target.name ?? (target.kind === "channel" ? `Kanal ${target.channel}` : targetLabel(target))) : "Frei";
  const label = targetLabel(target);
  const top = lcd && lcd.top.trim() !== "" ? lcd.top.trim() : fallbackName;
  const bottomRaw = lcd && lcd.bottom.trim() !== "" ? lcd.bottom.trim() : label;
  const bottom = target === null && !(lcd && lcd.bottom.trim() !== "") ? "—" : bottomRaw;
  const color = lcd && lcd.colorEnabled && lcd.color !== "off" ? LCD_COLOR_CSS[lcd.color] ?? null : null;
  return { target, top, bottom, color };
}

function channelStripSvg(cx, index, context) {
  const { role, fixed, interactive, activeLeds, uid } = context;
  const view = stripViewData(role, index);
  const selectable = interactive && fixed;
  const ring = Array.from({ length: 13 }, (_, segment) => {
    const angle = ((138 + segment * 22) * Math.PI) / 180;
    const dx = cx + Math.cos(angle) * 40;
    const dy = 110 + Math.sin(angle) * 40;
    return `<circle class="deck-ring${segment < 8 ? " is-lit" : ""}" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.4"/>`;
  }).join("");
  const meters = Array.from({ length: 8 }, (_, segment) => {
    const lit = segment < 5;
    const y = 252 + segment * 16.8;
    return `<rect class="deck-ring${lit ? " is-lit" : ""}" x="${cx - 40}" y="${y.toFixed(1)}" width="10" height="13" rx="2"/>`;
  }).join("");
  const stripButtons = [
    { label: "REC", y: 252 },
    { label: "SOLO", y: 295 },
    { label: "MUTE", y: 339 },
    { label: "SELECT", y: 383 },
  ]
    .map(
      (entry) =>
        `<g class="plain-key"><rect class="keycap" x="${cx + 5}" y="${entry.y - 12}" width="24" height="24" rx="4"/><text class="deck-text" x="${cx + 42}" y="${entry.y + 2}" font-size="5" text-anchor="start">${entry.label}</text></g>`,
    )
    .join("");
  const interactiveAttrs = selectable
    ? ` data-strip="${index}" role="button" tabindex="0" aria-label="Fader ${index + 1}: ${targetLabel(view.target)} wählen"`
    : "";
  const classes = `deck-strip${selectable ? " is-selectable" : ""}${view.target === null ? " is-empty" : ""}${lcdTextTone(view.color)}`;
  return `<g class="${classes}"${interactiveAttrs}>
    <circle class="deck-knob" cx="${cx}" cy="110" r="30" fill="url(#${uid}Knob)"/>
    <rect class="deck-knob-line" x="${cx - 1.5}" y="84" width="3" height="12" rx="1.5"/>
    ${ring}
    <rect class="deck-lcd" x="${cx - 43}" y="159" width="86" height="52" rx="4" fill="${view.color ?? "#101215"}"/>
    <text class="deck-lcd-text" translate="no" x="${cx}" y="181" font-size="10">${lcdClamp(view.top)}</text>
    <text class="deck-lcd-text" translate="no" x="${cx}" y="201" font-size="8">${lcdClamp(view.bottom)}</text>
    ${stripButtons}
    <rect class="select-led${activeLeds.has(index) ? " is-on" : ""}" x="${cx + 5}" y="399" width="24" height="5" rx="2"/>
    ${meters}
    <rect class="deck-slot" x="${cx - 5}" y="475" width="10" height="365" rx="5"/>
    <rect class="deck-cap" x="${cx - 13}" y="642" width="26" height="16" rx="4" fill="url(#${uid}Cap)"/>
    <text class="deck-text-sm" x="${cx}" y="872" font-size="10">${index + 1}</text>
  </g>`;
}

function deckKey(centerX, centerY, width, height, label, options = {}) {
  const fontSize = options.fontSize ?? 5.5;
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const labelY = options.labelBelow === false ? y + height / 2 + fontSize * 0.38 : y + height + fontSize + 4;
  const button = options.button ?? null;
  const interactive = Boolean(options.interactive) && Boolean(button);
  const assignment = button ? state.buttonAssignments[button] : null;
  const selected = interactive && state.selectedButton === button;
  const classes = button
    ? `deck-key${interactive ? " is-interactive" : ""}${assignment ? " is-assigned" : ""}${selected ? " is-selected" : ""}`
    : "plain-key";
  const attrs = interactive
    ? ` data-button="${button}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${buttonName(button)} belegen"`
    : button
      ? ` aria-hidden="true"`
      : "";
  const title = button && assignment ? `<title>${assignmentSummary(assignment)}</title>` : "";
  const dot = button ? `<circle class="dot" cx="${x + width - 8}" cy="${y + 8}" r="3"/>` : "";
  return `<g class="${classes}"${attrs}>${title}<rect class="keycap" x="${x}" y="${y}" width="${width}" height="${height}" rx="5"/><text class="deck-text" x="${centerX}" y="${labelY}" font-size="${fontSize}">${label}</text>${dot}</g>`;
}

function deviceDeckSvg(role, options = {}) {
  const uid = options.uid;
  const interactive = Boolean(options.interactive);
  const main = isMainRole(role);
  const channelCenters = [97, 193, 289, 385, 482, 578, 675, 773];
  const fkeyCenters = [951, 1000, 1050, 1099, 1148, 1198, 1247, 1297];
  const groupCenters = [951, 1009, 1066, 1124, 1181, 1238, 1297];
  const surface = state.surfaces[role];
  const fixed = surface.mode === "fixed";
  const activeLeds = state.ledOn[role] ?? new Set();
  const stripContext = { role, fixed, interactive, activeLeds, uid };
  const channels = channelCenters.map((cx, index) => channelStripSvg(cx, index, stripContext)).join("");
  const defs = `
      <linearGradient id="${uid}Chassis" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#26282c"/>
        <stop offset="0.55" stop-color="#1e2024"/>
        <stop offset="1" stop-color="#16171a"/>
      </linearGradient>
      <linearGradient id="${uid}Keycap" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3b3e44"/>
        <stop offset="1" stop-color="#2a2c31"/>
      </linearGradient>
      <linearGradient id="${uid}Cap" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d9dce2"/>
        <stop offset="1" stop-color="#9fa3ab"/>
      </linearGradient>
      <radialGradient id="${uid}Knob" cx="0.32" cy="0.28" r="0.9">
        <stop offset="0" stop-color="#5a5e66"/>
        <stop offset="0.68" stop-color="#26282c"/>
      </radialGradient>`;

  if (!main) {
    return `
  <svg viewBox="0 0 850 925" role="img" aria-label="X-Touch Extender Draufsicht">
    <defs>${defs}</defs>
    <rect class="xtouch-chassis" x="2" y="2" width="846" height="921" rx="24" fill="url(#${uid}Chassis)"/>
    <rect class="xtouch-inner" x="12" y="12" width="826" height="901" rx="16"/>
    ${channels}
    <text x="26" y="908" font-size="12" fill="#6c6f76" font-family="var(--mono)" letter-spacing="4">X-TOUCH EXTENDER</text>
  </svg>`;
  }

  const fkeys = FUNCTION_BUTTONS.map((button, index) =>
    deckKey(fkeyCenters[index], 337, 34, 26, buttonLabel(button), {
      button,
      interactive,
      fontSize: 8,
    }),
  ).join("");

  const key = (cx, cy, width, height, label, options = {}) =>
    deckKey(cx, cy, width, height, label, { ...options, interactive });

  const assignRow = [
    { label: "TRACK", cx: 872, button: "track" },
    { label: "PAN/SURR", cx: 921 },
    { label: "EQ", cx: 971, button: "eq" },
    { label: "SEND", cx: 1020 },
    { label: "PLUG-IN", cx: 1069, button: "plugin" },
    { label: "INST", cx: 1119, button: "instrument" },
  ]
    .map((entry) => key(entry.cx, 99, 44, 24, entry.label, { button: entry.button }))
    .join("");
  const viewRow = [
    { label: "GLOBAL VIEW", cx: 872, button: "global-view" },
    { label: "MIDI TRKS", cx: 951, button: "midi-tracks" },
    { label: "INPUTS", cx: 1000, button: "inputs" },
    { label: "AUDIO TRKS", cx: 1050, button: "audio-tracks" },
    { label: "AUDIO INST", cx: 1099, button: "audio-instruments" },
    { label: "AUX", cx: 1148, button: "aux" },
    { label: "BUSES", cx: 1198, button: "buses" },
    { label: "OUTPUTS", cx: 1247, button: "outputs" },
    { label: "USER", cx: 1297, button: "user" },
  ]
    .map((entry) => key(entry.cx, 260, 44, 24, entry.label, { fontSize: 4.6, button: entry.button }))
    .join("");
  const groupTop = [
    { label: "SHIFT" },
    { label: "OPTION" },
    { label: "READ/OFF", button: "read-off" },
    { label: "WRITE", button: "write" },
    { label: "TRIM", button: "trim" },
    { label: "SAVE", button: "save" },
    { label: "UNDO", button: "undo" },
  ];
  const groupBottom = [
    { label: "CONTROL" },
    { label: "ALT" },
    { label: "TOUCH", button: "touch" },
    { label: "LATCH", button: "latch" },
    { label: "GROUP", button: "group" },
    { label: "CANCEL", button: "cancel" },
    { label: "ENTER", button: "enter" },
  ];
  const groupRow = (entries, y) =>
    entries
      .map((entry, index) => key(groupCenters[index], y, 52, 24, entry.label, { button: entry.button }))
      .join("");
  const transportExtra = [
    { label: "MARKER", button: "marker" },
    { label: "NUDGE", button: "nudge" },
    { label: "CYCLE", button: "cycle" },
    { label: "DROP", button: "drop" },
    { label: "REPLACE", button: "replace" },
    { label: "CLICK", button: "click" },
    { label: "SOLO", button: "rude-solo" },
  ]
    .map((entry, index) =>
      key(groupCenters[index], 526, 52, 24, entry.label, { fontSize: 5, button: entry.button }),
    )
    .join("");
  const transportMain = [
    { label: "◀◀", cx: 967, button: "rewind" },
    { label: "▶▶", cx: 1046, button: "forward" },
    { label: "■", cx: 1125, button: "stop" },
    { label: "▶", cx: 1204, button: "play" },
    { label: "●", cx: 1283, button: "record" },
  ]
    .map((entry) => key(entry.cx, 588, 66, 26, entry.label, { fontSize: 11, button: entry.button }))
    .join("");
  const bankRow = key(967, 650, 52, 24, "◀ BANK") + key(1025, 650, 52, 24, "BANK ▶");
  const channelNavRow = key(967, 700, 52, 24, "◀ CH") + key(1025, 700, 52, 24, "CH ▶");
  const navCross = [
    { label: "▲", cx: 996, cy: 760, button: "nav-up" },
    { label: "◀", cx: 954, cy: 800, button: "nav-left" },
    { label: "•", cx: 996, cy: 800 },
    { label: "▶", cx: 1038, cy: 800, button: "nav-right" },
    { label: "▼", cx: 996, cy: 840, button: "nav-down" },
  ]
    .map((entry) =>
      key(entry.cx, entry.cy, 34, 32, entry.label, {
        fontSize: 9,
        labelBelow: false,
        button: entry.button,
      }),
    )
    .join("");
  const jogSpokes = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * 30 * Math.PI) / 180;
    const x = 1192 + Math.cos(angle) * 72;
    const y = 764 + Math.sin(angle) * 72;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#565a62"/>`;
  }).join("");

  return `
  <svg viewBox="0 0 1370 925" role="img" aria-label="X-Touch Draufsicht">
    <defs>${defs}</defs>
    <rect class="xtouch-chassis" x="2" y="2" width="1366" height="921" rx="24" fill="url(#${uid}Chassis)"/>
    <rect class="xtouch-inner" x="12" y="12" width="1346" height="901" rx="16"/>
    ${channels}
    ${assignRow}
    <rect class="deck-screen" x="904" y="159" width="340" height="52" rx="5"/>
    <g data-segment-display="${role}">${segmentDisplayMarkup(role)}</g>
    ${key(872, 185, 48, 26, "NAME/VALUE", { button: "name-value" })}
    ${key(1297, 185, 48, 26, "SMPTE/BEATS", { fontSize: 4.6, button: "smpte-beats" })}
    ${viewRow}
    ${fkeys}
    ${key(872, 383, 48, 26, "FLIP", { fontSize: 7 })}
    <rect class="deck-slot" x="867" y="475" width="10" height="365" rx="5"/>
    <rect class="deck-cap" x="859" y="642" width="26" height="16" rx="4" fill="url(#${uid}Cap)"/>
    <text class="deck-text-sm" x="872" y="872" font-size="9">MASTER</text>
    ${groupRow(groupTop, 406)}
    ${groupRow(groupBottom, 453)}
    ${transportExtra}
    ${transportMain}
    ${bankRow}
    ${channelNavRow}
    ${navCross}
    ${key(1297, 647, 48, 28, "SCRUB", { fontSize: 7, button: "scrub" })}
    <circle class="deck-ring" cx="1192" cy="764" r="100" fill="none" stroke="#33363b" stroke-width="6"/>
    <circle class="deck-knob" cx="1192" cy="764" r="62" fill="url(#${uid}Knob)"/>
    ${jogSpokes}
    <text class="deck-text-sm" x="1192" y="905" font-size="9">JOG / SHUTTLE</text>
    <text x="26" y="908" font-size="12" fill="#6c6f76" font-family="var(--mono)" letter-spacing="4">X-TOUCH</text>
  </svg>`;
}

function renderDevices() {
  const openDetails = new Set(
    [...dom.deviceRow.querySelectorAll(".midi-details[open]")].map((details) => details.closest(".device-card")?.dataset.role),
  );
  cardRefs.clear();
  dom.deviceRow.replaceChildren();
  for (const role of state.order) {
    const card = createCard(role);
    if (openDetails.has(role)) card.querySelector(".midi-details").open = true;
    dom.deviceRow.append(card);
  }
  updateAllCards();
  renderBank();
}

function updateAllCards() {
  for (const role of state.order) updateCard(role);
}

function updateCard(role) {
  const refs = cardRefs.get(role);
  if (!refs) return;
  const surface = state.surfaces[role];
  const device = state.devices[role];
  const preview = previewFor(role);
  const orderIndex = state.order.indexOf(role);

  refs.card.dataset.mode = surface.mode;
  refs.card.dataset.demo = String(state.demo);
  refs.card.classList.toggle("is-disabled", !device.enabled);
  refs.card.classList.toggle("is-finding", state.findingRoles.has(role));
  refs.order.textContent = String(orderIndex + 1).padStart(2, "0");

  const customName = typeof device.name === "string" ? device.name : "";
  const fallbackTitle = rolePlaceholder(role);
  refs.title.textContent = customName || fallbackTitle;
  refs.title.classList.toggle("is-custom", customName !== "");
  refs.subtitle.textContent = customName ? `${fallbackTitle} · ${roleSubtitle(role)}` : roleSubtitle(role);  refs.rename.setAttribute("aria-label", `${customName || fallbackTitle} umbenennen`);
  if (document.activeElement !== refs.nameInput) refs.nameInput.value = customName;
  refs.nameInput.placeholder = fallbackTitle;
  refs.encoder.value = device.encoder === "pan" ? "pan" : "off";
  refs.meters.checked = Boolean(device.meters);
  refs.remove.disabled = state.order.length <= 1;
  refs.remove.title = state.order.length <= 1 ? "Mindestens ein Gerät bleibt erhalten" : "Gerät entfernen";

  for (const button of refs.card.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === surface.mode));
  }
  const moveButtons = refs.card.querySelectorAll("[data-move]");
  if (moveButtons[0]) moveButtons[0].disabled = orderIndex === 0;
  if (moveButtons[1]) moveButtons[1].disabled = orderIndex === state.order.length - 1;

  const finding = state.findingRoles.has(role);
  refs.find.disabled = finding;
  refs.find.textContent = finding ? "Blinkt …" : "Finden";

  refs.enabled.checked = device.enabled;

  for (const button of refs.transportButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.transport === device.transport));
  }
  const networkSelected = device.transport === "network";
  refs.panels.usb.hidden = networkSelected;
  refs.panels.network.hidden = !networkSelected;
  if (document.activeElement !== refs.networkHost) refs.networkHost.value = device.network?.host ?? "";
  if (document.activeElement !== refs.networkPort) {
    refs.networkPort.value = String(device.network?.port ?? DEFAULT_NETWORK_PORT);
  }

  renderDeviceMini(role);
  if (state.dialogRole === role) {
    renderDeviceDialog(role);
    renderDialogEditor();
  }

  const fixedCount = surface.fixedTargets.filter((target) => target !== null).length;
  if (!device.enabled) {
    refs.note.textContent = "Gerät inaktiv · wird beim Banking nicht berücksichtigt";
  } else if (device.transport === "network") {
    refs.note.textContent = "Netzwerk · RTP-MIDI · nimmt am Banking teil";
  } else if (surface.mode === "fixed") {
    const busCount = surface.fixedTargets.filter((target) => target?.kind === "bus").length;
    refs.note.textContent = fixedCount === 0
      ? "Fest · alle acht Fader frei"
      : `Fest · ${fixedCount} von 8 Fadern belegt${busCount > 0 ? ` · ${busCount} Bus${busCount === 1 ? "" : "se"}` : ""}`;
  } else {
    const channels = (preview?.strips ?? [])
      .map((strip) => strip.target)
      .filter((target) => target?.kind === "channel")
      .map((target) => target.channel)
      .filter((channel) => channel !== null);
    if (channels.length === 0) {
      refs.note.textContent = state.channels.length === 0 ? "Banking · Kanäle einlesen" : "Banking · keine Kanäle in dieser Bank";
    } else {
      const sorted = [...channels].sort((a, b) => a - b);
      const contiguous = sorted.every((channel, index) => index === 0 || channel === sorted[index - 1] + 1);
      refs.note.textContent = contiguous
        ? `Banking · Kanäle ${sorted[0]}–${sorted[sorted.length - 1]}`
        : `Banking · ${sorted.length} Kanäle in dieser Bank`;
    }
  }

  updatePortStatus(role);
}

function updatePortStatus(role) {
  const refs = cardRefs.get(role);
  if (!refs) return;
  const device = state.devices[role];

  if (device.transport === "network") {
    refs.pip.classList.remove("is-online");
    refs.inputStatus.textContent = "";
    refs.outputStatus.textContent = "";
    delete refs.inputStatus.dataset.tone;
    delete refs.outputStatus.dataset.tone;
    const host = (device.network?.host ?? "").trim();
    const port = device.network?.port ?? DEFAULT_NETWORK_PORT;
    refs.summary.textContent = host ? `Netzwerk · ${host}:${port}` : "Netzwerk · Adresse fehlt";
    if (host === "") {
      refs.portStatus.textContent = "Netzwerk vorbereitet · IP-Adresse eintragen";
      refs.portStatus.dataset.tone = "error";
    } else if (state.demo) {
      refs.portStatus.textContent = `Netzwerk · Simulation für ${host}:${port}`;
      refs.portStatus.dataset.tone = "success";
    } else {
      refs.portStatus.textContent = `Netzwerk gespeichert · RTP-MIDI (${host}:${port})`;
      delete refs.portStatus.dataset.tone;
    }
    return;
  }

  const input = findPort(state.midi.inputs, device.input);
  const output = findPort(state.midi.outputs, device.output);
  const ready = device.enabled && input !== null && output !== null;
  refs.pip.classList.toggle("is-online", ready);

  refs.inputStatus.textContent = input
    ? `Eingang  ${portLabel(input)} · erkannt`
    : `Eingang  ${selectorLabel(device.input)} · nicht gefunden`;
  refs.outputStatus.textContent = output
    ? `Ausgang  ${portLabel(output)} · erkannt`
    : `Ausgang  ${selectorLabel(device.output)} · nicht gefunden`;
  refs.inputStatus.dataset.tone = input ? "success" : "error";
  refs.outputStatus.dataset.tone = output ? "success" : "error";

  if (state.midi.error) {
    refs.summary.textContent = "MIDI-Liste nicht verfügbar";
    refs.portStatus.textContent = state.midi.error;
    refs.portStatus.dataset.tone = "error";
    refs.inputStatus.textContent = "Eingang  nicht prüfbar";
    refs.outputStatus.textContent = "Ausgang  nicht prüfbar";
    delete refs.inputStatus.dataset.tone;
    delete refs.outputStatus.dataset.tone;
    refs.pip.classList.remove("is-online");
    return;
  }

  if (!device.enabled) {
    refs.summary.textContent = "Gerät deaktiviert";
    refs.portStatus.textContent = "Gerät aktivieren, damit die Ports genutzt werden";
    refs.portStatus.dataset.tone = "error";
    refs.pip.classList.remove("is-online");
    return;
  }

  refs.summary.textContent = output ? portLabel(output) : "Kein Ausgang";
  if (input && output) {
    refs.portStatus.textContent = "Ein- und Ausgang erkannt";
    refs.portStatus.dataset.tone = "success";
  } else if (!input && !output) {
    refs.portStatus.textContent = "Ein- und Ausgang fehlen";
    refs.portStatus.dataset.tone = "error";
  } else if (!input) {
    refs.portStatus.textContent = "Eingang fehlt";
    refs.portStatus.dataset.tone = "error";
  } else {
    refs.portStatus.textContent = "Ausgang fehlt";
    refs.portStatus.dataset.tone = "error";
  }
}

async function refreshPorts() {
  if (dom.refreshPorts.disabled) return;
  dom.refreshPorts.disabled = true;
  dom.portsMessage.textContent = "Lese MIDI-Ports …";
  delete dom.portsMessage.dataset.tone;
  try {
    const data = await api("/api/midi/ports");
    state.midi = {
      inputs: Array.isArray(data.inputs) ? data.inputs : [],
      outputs: Array.isArray(data.outputs) ? data.outputs : [],
      error: typeof data.error === "string" ? data.error : null,
    };
    for (const role of state.order) {
      const refs = cardRefs.get(role);
      if (!refs) continue;
      fillPortSelect(refs.input, state.midi.inputs, state.devices[role].input);
      fillPortSelect(refs.output, state.midi.outputs, state.devices[role].output);
      updateCard(role);
    }
    dom.portsMessage.textContent = state.midi.error
      ? `Ports nicht verfügbar: ${state.midi.error}`
      : `${state.midi.inputs.length} Eingänge, ${state.midi.outputs.length} Ausgänge gelesen`;
    dom.portsMessage.dataset.tone = state.midi.error ? "error" : "success";
  } catch (error) {
    dom.portsMessage.textContent = error.message;
    dom.portsMessage.dataset.tone = "error";
  } finally {
    dom.refreshPorts.disabled = false;
  }
}

function updateLeds(role) {
  const refs = cardRefs.get(role);
  if (!refs) return;
  renderDeviceMini(role);
  syncDeviceLeds(role);
}

function clearRoleLeds(role) {
  const active = state.ledOn[role];
  if (!active || active.size === 0) return;
  active.clear();
  updateLeds(role);
}

function moveRole(role, direction) {
  const index = state.order.indexOf(role);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.order.length) return;
  const next = [...state.order];
  [next[index], next[target]] = [next[target], next[index]];
  state.order = next;
  markDirty();
  renderDevices();
  schedulePreview();
}

function firstUnusedPort() {
  const used = new Set(state.order.map((role) => selectorKey(state.devices[role].output)));
  const candidate = describePorts(state.midi.outputs).find(
    (port) => !used.has(selectorKey({ name: port.name, occurrence: port.occurrence })),
  );
  if (!candidate) return null;
  return { name: candidate.name, occurrence: candidate.occurrence };
}

function applyPorts(ports) {
  if (!ports) return;
  state.midi = {
    inputs: Array.isArray(ports.inputs) ? ports.inputs : state.midi.inputs,
    outputs: Array.isArray(ports.outputs) ? ports.outputs : state.midi.outputs,
    error: typeof ports.error === "string" ? ports.error : null,
  };
  dom.portsMessage.textContent = state.midi.error
    ? `Ports nicht verfügbar: ${state.midi.error}`
    : `${state.midi.inputs.length} Eingänge, ${state.midi.outputs.length} Ausgänge gelesen`;
  dom.portsMessage.dataset.tone = state.midi.error ? "error" : "success";
}

async function addDevice() {
  if (dom.addDevice.disabled) return;
  const role = nextRoleId();
  const device = defaultDevice(role);
  const hasMain = state.order.some((entry) => state.devices[entry].kind === "main");
  device.kind = hasMain ? "extender" : "main";
  let port = null;
  if (state.demo) {
    dom.addDevice.disabled = true;
    try {
      const name = device.kind === "main" ? DEFAULT_PORTS.main : "X-Touch Extender";
      const data = await api("/api/midi/ports", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      port = data?.input ?? null;
      applyPorts(data?.ports);
    } catch (error) {
      showToast(error.message, "error");
      return;
    } finally {
      dom.addDevice.disabled = false;
    }
  } else {
    port = firstUnusedPort();
  }
  if (port) {
    device.input = { ...port };
    device.output = { ...port };
  }
  state.order = [...state.order, role];
  state.devices[role] = device;
  state.surfaces[role] = { mode: "banking", fixedTargets: Array(STRIPS_PER_SURFACE).fill(null) };
  state.ledOn[role] = new Set();
  state.bankOffset = 0;
  markDirty();
  renderDevices();
  schedulePreview();
  showToast(
    port
      ? `Gerät hinzugefügt · Port ${port.name}${port.occurrence > 0 ? ` #${port.occurrence + 1}` : ""}`
      : "Gerät hinzugefügt · bitte Anschluss wählen",
    "success",
  );
}

function removeDevice(role) {
  if (state.order.length <= 1) {
    showToast("Mindestens ein Gerät bleibt erhalten.", "error");
    return;
  }
  const wasMain = state.devices[role]?.kind === "main";
  state.order = state.order.filter((entry) => entry !== role);
  delete state.devices[role];
  delete state.surfaces[role];
  delete state.ledOn[role];
  cardRefs.delete(role);
  if (wasMain && state.order.length > 0) {
    state.devices[state.order[0]].kind = "main";
  }
  state.bankOffset = 0;
  markDirty();
  renderDevices();
  schedulePreview();
  showToast("Gerät entfernt. Die Änderung gilt nach dem Speichern und einem Bridge-Neustart.", "info", 6000);
}

function setMode(role, mode) {
  if (mode !== "fixed" && mode !== "banking") return;
  if (state.surfaces[role].mode === mode) return;
  state.surfaces[role].mode = mode;
  state.bankOffset = 0;
  markDirty();
  updateCard(role);
  schedulePreview();
}

function setTransport(role, transport) {
  if (transport !== "usb" && transport !== "network") return;
  if (state.devices[role].transport === transport) return;
  state.devices[role].transport = transport;
  state.bankOffset = 0;
  markDirty();
  updateCard(role);
  schedulePreview();
  if (transport === "network") {
    const details = cardRefs.get(role)?.card.querySelector(".midi-details");
    if (details) details.open = true;
  }
}

function setNetworkStatus(refs, text, tone) {
  if (!refs) return;
  refs.networkStatus.textContent = text;
  if (tone) refs.networkStatus.dataset.tone = tone;
  else delete refs.networkStatus.dataset.tone;
}

async function testNetworkDevice(role) {
  const refs = cardRefs.get(role);
  const device = state.devices[role];
  if (!refs) return;
  const host = (device.network?.host ?? "").trim();
  const port = device.network?.port ?? DEFAULT_NETWORK_PORT;
  if (host === "") {
    setNetworkStatus(refs, "Bitte zuerst eine IP-Adresse eintragen.", "error");
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65534) {
    setNetworkStatus(refs, "Der RTP-Port muss zwischen 1 und 65534 liegen.", "error");
    return;
  }
  refs.networkTest.disabled = true;
  setNetworkStatus(refs, "Prüfe Verbindung …");
  try {
    const data = await api("/api/network/test", {
      method: "POST",
      body: JSON.stringify({ role, host, port }),
    });
    const suffix = data.simulated ? " · Simulation" : "";
    setNetworkStatus(refs, `${data.message ?? "Verbindung erreichbar"}${suffix}`, "success");
  } catch (error) {
    setNetworkStatus(refs, error.message, "error");
  } finally {
    refs.networkTest.disabled = false;
  }
}

function wireDrag(role, card, handle) {
  handle.addEventListener("dragstart", (event) => {
    draggingRole = role;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", role);
    card.classList.add("is-dragging");
    void blinkWhileDragging(role);
  });
  handle.addEventListener("dragend", cleanupDrag);
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveRole(role, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveRole(role, 1);
    }
  });
  card.addEventListener("dragover", (event) => {
    if (!draggingRole || draggingRole === role) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = card.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    card.classList.toggle("drop-before", before);
    card.classList.toggle("drop-after", !before);
  });
  card.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && card.contains(event.relatedTarget)) return;
    card.classList.remove("drop-before", "drop-after");
  });
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain") || draggingRole;
    if (!source || source === role) {
      cleanupDrag();
      return;
    }
    const rect = card.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    const next = [...state.order];
    const sourceIndex = next.indexOf(source);
    if (sourceIndex < 0) {
      cleanupDrag();
      return;
    }
    next.splice(sourceIndex, 1);
    let insertAt = next.indexOf(role);
    if (!before) insertAt += 1;
    next.splice(insertAt, 0, source);
    state.order = next;
    cleanupDrag();
    markDirty();
    renderDevices();
    schedulePreview();
  });
}

function cleanupDrag() {
  draggingRole = null;
  for (const card of dom.deviceRow.querySelectorAll(".device-card")) {
    card.classList.remove("is-dragging", "drop-before", "drop-after");
  }
}

function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void requestPreview();
  }, 50);
}

async function requestPreview() {
  const token = ++previewToken;
  try {
    const data = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify({
        layout: buildLayout(),
        bankOffset: state.bankOffset,
        enabledRoles: enabledRoles(),
        lcd: buildLcdConfig(),
      }),
    });
    if (token !== previewToken) return;
    state.preview = data;
    state.bankOffset = data.bankOffset;
    updateAllCards();
    renderBank();
  } catch (error) {
    if (token === previewToken) showToast(error.message, "error");
  }
}

function renderBank() {
  const preview = state.preview;
  if (!preview || preview.bankStep <= 0) {
    dom.bankLabel.textContent = "Kein Banking";
    dom.bankPrev.disabled = true;
    dom.bankNext.disabled = true;
    return;
  }
  const page = Math.floor(preview.bankOffset / preview.bankStep) + 1;
  dom.bankLabel.textContent = `Bank ${page} / ${preview.bankPages}`;
  dom.bankPrev.disabled = preview.bankOffset <= 0;
  dom.bankNext.disabled = page >= preview.bankPages;
}

function moveBank(direction) {
  const preview = state.preview;
  if (!preview || preview.bankStep <= 0) return;
  const offset = state.bankOffset + direction * preview.bankStep;
  const max = Math.max(0, (preview.bankPages - 1) * preview.bankStep);
  state.bankOffset = Math.min(max, Math.max(0, offset));
  void requestPreview();
}

function openChannelDialog(role, strip) {
  dialogContext = { role, strip };
  const displayName = state.devices[role]?.name || rolePlaceholder(role);
  dom.channelDialogTitle.textContent = `Ziel für ${displayName} · Fader ${strip + 1}`;
  dom.channelDialogContext.textContent =
    "Eingänge und Busse bleiben fest auf diesem Fader. Banking blättert nur durch Eingänge.";
  dom.channelSearch.value = "";
  renderChannelList();
  dom.channelDialog.showModal();
  window.setTimeout(() => dom.channelSearch.focus(), 30);
}

function renderChannelList() {
  dom.channelList.replaceChildren();
  if (!dialogContext) return;
  const { role, strip } = dialogContext;
  const current = state.surfaces[role].fixedTargets[strip] ?? null;
  const query = dom.channelSearch.value.trim().toLowerCase();
  const channels = state.channels.filter((channel) => {
    if (!query) return true;
    const index = String(channel.index).padStart(2, "0");
    return channel.name.toLowerCase().includes(query) || index.includes(query) || String(channel.index) === query;
  });
  const buses = state.buses.filter((bus) => {
    if (!query) return true;
    const label = `${BUS_LABELS[bus.type] ?? bus.type} ${bus.index}`.toLowerCase();
    return bus.name.toLowerCase().includes(query) || label.includes(query) || String(bus.index) === query;
  });
  dom.channelHint.textContent =
    `${state.channels.length} Eingänge · ${state.buses.length} Busse · aktuell ${current ? `${targetLabel(current)} ${targetName(current)}` : "frei"}`;

  if (channels.length === 0 && buses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "channel-empty";
    const strong = document.createElement("strong");
    strong.textContent = state.channels.length === 0 && state.buses.length === 0 ? "Keine Ziele geladen" : "Kein Treffer";
    const text = document.createElement("span");
    text.textContent = state.channels.length === 0 && state.buses.length === 0
      ? "Eingänge und Busse zuerst über Fairlight einlesen."
      : "Andere Suche versuchen.";
    empty.append(strong, text);
    dom.channelList.append(empty);
    return;
  }

  const addOption = (target, indexLabel, nameText) => {
    const owner = fixedOwner(target, role, strip);
    const selected = targetKey(current) === targetKey(target);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    button.disabled = owner !== null;

    const index = document.createElement("span");
    index.className = "channel-index";
    index.textContent = indexLabel;
    const name = document.createElement("span");
    name.className = "channel-option-name";
    name.setAttribute("translate", "no");
    name.textContent = nameText;
    const note = document.createElement("span");
    note.className = "channel-option-note";
    if (selected) note.textContent = "Aktuell";
    else if (owner) note.textContent = `Fest · ${roleShort(owner.role)} F${owner.strip + 1}`;
    else note.textContent = "Verfügbar";

    button.append(index, name, note);
    button.addEventListener("click", () => {
      state.surfaces[role].fixedTargets[strip] = target;
      markDirty();
      updateCard(role);
      schedulePreview();
      dom.channelDialog.close();
    });
    dom.channelList.append(button);
  };

  if (buses.length > 0) {
    const group = document.createElement("div");
    group.className = "target-group";
    const heading = document.createElement("div");
    heading.className = "target-group-title";
    heading.textContent = `Busse · ${buses.length}`;
    group.append(heading);
    dom.channelList.append(group);
    for (const bus of buses) {
      addOption(
        { kind: "bus", busType: bus.type, index: bus.index },
        `${BUS_LABELS[bus.type] ?? bus.type.toUpperCase()} ${bus.index}`,
        bus.name,
      );
    }
  }

  if (channels.length > 0) {
    const group = document.createElement("div");
    group.className = "target-group";
    const heading = document.createElement("div");
    heading.className = "target-group-title";
    heading.textContent = `Eingänge · ${channels.length}`;
    group.append(heading);
    dom.channelList.append(group);
    for (const channel of channels) {
      addOption(
        { kind: "channel", channel: channel.index },
        String(channel.index).padStart(2, "0"),
        channel.name,
      );
    }
  }
}

async function findDevice(role) {
  if (state.findingRoles.has(role)) return false;
  const problem = findDeviceProblem(role);
  if (problem) {
    showToast(problem, "error");
    return false;
  }
  const device = state.devices[role];
  const network = device.transport === "network";
  state.findingRoles.add(role);
  const active = state.ledOn[role];
  if (active) {
    for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) active.add(strip);
    updateLeds(role);
  }
  updateCard(role);
  try {
    await api("/api/find", {
      method: "POST",
      body: JSON.stringify(network ? { role } : { role, output: device.output }),
    });
    return true;
  } catch (error) {
    showToast(error.message, "error", 6000);
    return false;
  } finally {
    state.findingRoles.delete(role);
    updateCard(role);
    window.setTimeout(() => {
      if (dragFindRole !== role) clearRoleLeds(role);
    }, 450);
  }
}

function findDeviceProblem(role) {
  const device = state.devices[role];
  if (!device.enabled) return "Dieses Gerät ist deaktiviert.";
  if (device.transport === "network") {
    if (!(device.network?.host ?? "").trim()) return "Bitte zuerst eine IP-Adresse eintragen.";
    const port = device.network?.port ?? DEFAULT_NETWORK_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "Der RTP-Port muss zwischen 1 und 65535 liegen.";
    }
    return null;
  }
  if (!device.output?.name) return "Für dieses Gerät ist kein MIDI-Ausgang ausgewählt.";
  if (!findPort(state.midi.outputs, device.output)) {
    return `MIDI-Ausgang „${device.output.name}“ wurde nicht gefunden.`;
  }
  return null;
}

async function blinkWhileDragging(role) {
  if (dragFindRole === role) return;
  if (findDeviceProblem(role)) return;
  dragFindRole = role;
  try {
    while (draggingRole === role) {
      const ok = await findDevice(role);
      if (!ok || draggingRole !== role) break;
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  } finally {
    if (dragFindRole === role) dragFindRole = null;
    if (draggingRole !== role) clearRoleLeds(role);
  }
}

function startDemoPolling() {
  if (!state.demo || demoPollTimer !== null) return;
  const poll = async () => {
    try {
      const data = await api(`/api/demo/midi?since=${state.demoSince ?? 0}`);
      if (typeof data.seq === "number" && data.seq < (state.demoSince ?? 0)) state.demoSince = 0;
      state.demoSince = data.seq ?? state.demoSince;
      for (const event of data.events ?? []) applyDemoEvent(event);
    } catch {
      // The demo stream is optional; the UI keeps working without it.
    }
    demoPollTimer = window.setTimeout(poll, 150);
  };
  void poll();
}

function applyDemoEvent(event) {
  const message = event.message;
  if (!Array.isArray(message) || message.length < 3) return;
  const status = message[0] ?? 0;
  const note = message[1] ?? 0;
  const value = message[2] ?? 0;
  if ((status & 0xf0) !== 0x90) return;
  if (note < SELECT_NOTE_BASE || note >= SELECT_NOTE_BASE + STRIPS_PER_SURFACE) return;
  const set = state.ledOn[event.role];
  if (!set) return;
  const strip = note - SELECT_NOTE_BASE;
  if (value > 0) set.add(strip);
  else set.delete(strip);
  updateLeds(event.role);
}

async function discoverChannels(event) {
  event.preventDefault();
  const host = dom.fairlightHost.value.trim();
  const port = Number(dom.fairlightPort.value);
  if (!host) {
    setDiscoverMessage("Bitte einen Host eintragen.", "error");
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setDiscoverMessage("Der Port muss zwischen 1 und 65535 liegen.", "error");
    return;
  }
  if (host !== state.fairlight.host || port !== state.fairlight.port) {
    state.fairlight = { host, port };
    markDirty();
  }
  dom.discoverButton.classList.add("is-busy");
  dom.discoverButton.disabled = true;
  setDiscoverMessage("Verbinde mit Fairlight …");
  try {
    const data = await api("/api/discover", {
      method: "POST",
      body: JSON.stringify({ host, port }),
    });
    state.channels = [...(data.channels ?? [])].sort((a, b) => a.index - b.index);
    state.channelByName = new Map(state.channels.map((channel) => [channel.index, channel.name]));
    state.buses = Array.isArray(data.buses) ? [...data.buses] : [];
    state.busByName = new Map(state.buses.map((bus) => [busStorageKey(bus.type, bus.index), bus.name]));
    state.monitors = Array.isArray(data.monitors) ? [...data.monitors].sort((a, b) => a.index - b.index) : [];
    state.discoverError = null;
    setDiscoverMessage(
      `${state.channels.length} Eingänge, ${state.buses.length} Busse und ${state.monitors.length} Monitore erkannt.`,
      "success",
    );
    updateStatus();
    renderLcdOverrideList();
    if (state.dialogRole) refreshDeviceDialog();
    await requestPreview();
  } catch (error) {
    state.discoverError = error.message;
    setDiscoverMessage(error.message, "error");
    updateStatus();
  } finally {
    dom.discoverButton.classList.remove("is-busy");
    dom.discoverButton.disabled = false;
  }
}

function updateOnAirBadge() {
  if (!dom.onAirBadge) return;
  dom.onAirBadge.hidden = state.demo;
  if (state.demo) return;
  const value = state.onAir;
  dom.onAirBadge.dataset.state = value === true ? "on" : value === false ? "off" : "unknown";
  dom.onAirBadge.textContent = value === true ? "ON AIR" : value === false ? "OFF AIR" : "Unbekannt";
}

function startOnAirPolling() {
  if (onAirPollTimer !== null || state.demo) return;
  const poll = async () => {
    try {
      const data = await api("/api/onair");
      state.onAir = data?.onAir === true ? true : data?.onAir === false ? false : null;
      updateOnAirBadge();
    } catch {
      // Keep the last confirmed state when the bridge is briefly unreachable.
    }
  };
  onAirPollTimer = window.setInterval(() => {
    void poll();
  }, 5000);
  void poll();
}

function updateStatus() {
  const count = state.channels.length;
  const busCount = state.buses.length;
  dom.channelCount.textContent = state.loading
    ? "Kanäle werden geladen"
    : count === 0
      ? "Keine Kanäle"
      : `${count} Eingänge · ${busCount} Busse`;
  if (state.demo) {
    dom.fairlightPill.dataset.state = "ok";
    dom.fairlightStatus.textContent = `Demo · ${count} Eingänge · ${busCount} Busse`;
  } else if (state.discoverError) {
    dom.fairlightPill.dataset.state = "error";
    dom.fairlightStatus.textContent = "Fairlight nicht erreichbar";
  } else if (count > 0) {
    dom.fairlightPill.dataset.state = "ok";
    dom.fairlightStatus.textContent = `${count} Eingänge · ${busCount} Busse erkannt`;
  } else {
    dom.fairlightPill.dataset.state = "idle";
    dom.fairlightStatus.textContent = "Keine Kanäle geladen";
  }
}

async function saveSettings() {
  if (!state.dirty || state.saving) return;
  const safety = state.app ? buildSafety() : null;
  if (state.app && safety === null) return;
  state.saving = true;
  updateSavebar();
  try {
    const result = await api("/api/save", {
      method: "POST",
      body: JSON.stringify({
        layout: buildLayout(),
        fairlight: { host: state.fairlight.host, port: state.fairlight.port },
        lcd: buildLcdConfig(),
        sendsOnFader: {
          enabled: state.sendsOnFader.enabled,
          busIndex: state.sendsOnFader.busIndex,
        },
        buttonAssignments: state.buttonAssignments,
        ...(safety ? { safety } : {}),
        devices: state.order.map((role) => ({
          role,
          kind: state.devices[role].kind,
          name: state.devices[role].name,
          enabled: state.devices[role].enabled,
          transport: state.devices[role].transport,
          input: state.devices[role].input,
          output: state.devices[role].output,
          encoder: state.devices[role].encoder,
          meters: state.devices[role].meters,
          mainDisplay: state.devices[role].mainDisplay,
          network:
            state.devices[role].transport === "network"
              ? {
                  host: state.devices[role].network.host.trim(),
                  port: state.devices[role].network.port,
                }
              : null,
        })),
      }),
    });
    state.saving = false;
    if (result?.config) state.config = result.config;
    markClean();
    if (result?.requiresRestart === false) {
      await refreshAppInfo();
      showToast("Gespeichert. Die Bridge läuft mit der neuen Belegung.", "success", 6000);
    } else {
      showToast("Gespeichert. Die neue Belegung gilt beim nächsten Bridge-Start.", "success", 6000);
    }
  } catch (error) {
    state.saving = false;
    updateSavebar();
    showToast(error.message, "error", 6000);
  }
}

function wireStaticEvents() {
  dom.langSelect.addEventListener("change", () => {
    dom.langSelect.value = setLanguage(dom.langSelect.value);
  });
  dom.discoverForm.addEventListener("submit", (event) => {
    void discoverChannels(event);
  });
  dom.mainDisplayMode.addEventListener("change", () => {
    const role = state.dialogRole;
    if (!role || !isMainRole(role)) return;
    const display = state.devices[role].mainDisplay;
    display.mode = MAIN_DISPLAY_MODES.includes(dom.mainDisplayMode.value)
      ? dom.mainDisplayMode.value
      : "off";
    if (display.mode === "meter" && !display.meter) {
      display.meter = { measurement: "loudness", target: { kind: "bus", busType: "main", index: 1 } };
    }
    markDirty();
    renderDialogEditor();
    refreshSegmentDisplays();
  });
  dom.mainDisplayMeasurement.addEventListener("change", () => {
    const role = state.dialogRole;
    if (!role || !isMainRole(role)) return;
    const meter = state.devices[role].mainDisplay.meter;
    if (!meter) return;
    meter.measurement = MAIN_DISPLAY_MEASUREMENTS.includes(dom.mainDisplayMeasurement.value)
      ? dom.mainDisplayMeasurement.value
      : "loudness";
    if (meter.measurement === "loudness" && meter.target.busType !== "main") {
      meter.target = { kind: "bus", busType: "main", index: 1 };
    }
    markDirty();
    renderDialogEditor();
    refreshSegmentDisplays();
  });
  dom.mainDisplayTarget.addEventListener("change", () => {
    const role = state.dialogRole;
    if (!role || !isMainRole(role)) return;
    const meter = state.devices[role].mainDisplay.meter;
    if (!meter) return;
    const [busType, rawIndex] = String(dom.mainDisplayTarget.value).split(":");
    const index = Number(rawIndex);
    if (!Object.prototype.hasOwnProperty.call(BUS_LABELS, busType) || !Number.isInteger(index) || index < 1) {
      return;
    }
    meter.target = { kind: "bus", busType, index };
    markDirty();
    refreshSegmentDisplays();
  });
  dom.mainDisplayScope.addEventListener("change", () => {
    const role = state.dialogRole;
    if (!role || !isMainRole(role)) return;
    state.devices[role].mainDisplay.scope = dom.mainDisplayScope.value === "main" ? "main" : "surface";
    markDirty();
    renderDialogEditor();
    refreshSegmentDisplays();
  });
  dom.buttonFunction.addEventListener("change", () => {
    const value = dom.buttonFunction.value;
    const selected = state.selectedButton;
    const existing = state.buttonAssignments[selected];
    if (value === "sends-on-fader") {
      const auxIndex =
        existing?.type === "sends-on-fader" ? existing.auxIndex : (state.sendsOnFader.busIndex ?? 1);
      state.buttonAssignments[selected] = { type: "sends-on-fader", auxIndex };
    } else if (value === "monitor-dim") {
      const monitorIndex =
        existing?.type === "monitor-dim" ? existing.monitorIndex : (state.monitors[0]?.index ?? 1);
      state.buttonAssignments[selected] = { type: "monitor-dim", monitorIndex };
    } else {
      delete state.buttonAssignments[selected];
    }
    markDirty();
    refreshDeviceDialog();
  });
  dom.buttonAux.addEventListener("change", () => {
    const selected = state.selectedButton;
    const assignment = state.buttonAssignments[selected];
    const value = Number(dom.buttonAux.value);
    if (!assignment || assignment.type !== "sends-on-fader" || !Number.isInteger(value) || value < 1) return;
    assignment.auxIndex = value;
    markDirty();
    refreshDeviceDialog();
  });
  dom.buttonMonitor.addEventListener("change", () => {
    const selected = state.selectedButton;
    const assignment = state.buttonAssignments[selected];
    const value = Number(dom.buttonMonitor.value);
    if (!assignment || assignment.type !== "monitor-dim" || !Number.isInteger(value) || value < 1) return;
    assignment.monitorIndex = value;
    markDirty();
    refreshDeviceDialog();
  });
  dom.bankPrev.addEventListener("click", () => moveBank(-1));
  dom.bankNext.addEventListener("click", () => moveBank(1));
  dom.addDevice.addEventListener("click", addDevice);
  dom.refreshPorts.addEventListener("click", () => {
    void refreshPorts();
  });
  dom.lcdEnabled.addEventListener("change", () => {
    state.lcd.colorsEnabled = dom.lcdEnabled.checked;
    markDirty();
    updateLcdSummary();
    updateAllCards();
    schedulePreview();
  });
  dom.lcdLine1.addEventListener("change", () => {
    state.lcd.line1 = dom.lcdLine1.value;
    markDirty();
    updateAllCards();
    schedulePreview();
  });
  dom.lcdLine2.addEventListener("change", () => {
    state.lcd.line2 = dom.lcdLine2.value;
    markDirty();
    updateAllCards();
    schedulePreview();
  });
  dom.lcdReset.addEventListener("click", resetLcdPalette);
  dom.lcdSearch.addEventListener("input", () => {
    state.lcdSearch = dom.lcdSearch.value;
    renderLcdOverrideList();
  });
  dom.saveButton.addEventListener("click", () => {
    void saveSettings();
  });
  dom.appAutostart.addEventListener("change", () => {
    void updateAppSettings({ autostart: dom.appAutostart.checked });
  });
  dom.appWrites.addEventListener("change", () => {
    void updateAppSettings({
      writes: dom.appWrites.checked,
      motors: dom.appWrites.checked ? dom.appMotors.checked : false,
    });
  });
  dom.appMotors.addEventListener("change", () => {
    void updateAppSettings({ motors: dom.appMotors.checked });
  });
  for (const field of [dom.allowedChannels, dom.allowedBuses, dom.allowedMonitors]) {
    field.addEventListener("input", markDirty);
  }
  dom.reloadButton.addEventListener("click", () => {
    if (state.dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    void loadState().then(() => showToast("Vom Server neu geladen."));
  });
  dom.channelSearch.addEventListener("input", renderChannelList);
  dom.channelDialogClose.addEventListener("click", () => dom.channelDialog.close());
  dom.channelDialog.addEventListener("close", () => {
    dialogContext = null;
  });
  dom.deviceDialogClose.addEventListener("click", () => dom.deviceDialog.close());
  dom.deviceDialog.addEventListener("close", () => {
    const opener = state.dialogOpener;
    state.dialogRole = null;
    state.dialogOpener = null;
    dialogSendActive = false;
    dialogOnAirSim = null;
    stopSegmentClock();
    updateAllCards();
    if (opener && document.contains(opener)) window.setTimeout(() => opener.focus(), 30);
  });
  dom.channelClear.addEventListener("click", () => {
    if (!dialogContext) return;
    const { role, strip } = dialogContext;
    state.surfaces[role].fixedTargets[strip] = null;
    markDirty();
    updateCard(role);
    schedulePreview();
    dom.channelDialog.close();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("beforeunload", () => {
    if (onAirPollTimer === null) return;
    window.clearInterval(onAirPollTimer);
    onAirPollTimer = null;
  });
}

wireStaticEvents();
void loadState();
