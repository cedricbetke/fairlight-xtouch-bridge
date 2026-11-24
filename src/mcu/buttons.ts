/**
 * Assignable X-Touch keys on the main surface.
 *
 * Notes follow the MCU reference in `docs/protocols/XTouch_USB_MCU_Referenz.md`.
 * Only keys with a documented note are listed. BANK, SEND, PAN and FLIP stay
 * reserved: banking and the way back to the main mix must always work.
 */

export const FUNCTION_BUTTON_IDS = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"] as const;
export type FunctionButtonId = (typeof FUNCTION_BUTTON_IDS)[number];

export const EXTRA_BUTTON_IDS = [
  "track",
  "eq",
  "plugin",
  "instrument",
  "global-view",
  "midi-tracks",
  "inputs",
  "audio-tracks",
  "audio-instruments",
  "aux",
  "buses",
  "outputs",
  "user",
  "name-value",
  "smpte-beats",
  "read-off",
  "write",
  "trim",
  "touch",
  "latch",
  "group",
  "save",
  "undo",
  "cancel",
  "enter",
  "marker",
  "nudge",
  "cycle",
  "drop",
  "replace",
  "click",
  "rude-solo",
  "rewind",
  "forward",
  "stop",
  "play",
  "record",
  "nav-up",
  "nav-down",
  "nav-left",
  "nav-right",
  "scrub",
] as const;

export const BUTTON_IDS = [...FUNCTION_BUTTON_IDS, ...EXTRA_BUTTON_IDS] as const;
export type ButtonId = (typeof BUTTON_IDS)[number];

export interface ButtonDefinition {
  id: ButtonId;
  label: string;
  note: number;
}

const FUNCTION_BUTTON_NOTES: Record<FunctionButtonId, number> = {
  f1: 54,
  f2: 55,
  f3: 56,
  f4: 57,
  f5: 58,
  f6: 59,
  f7: 60,
  f8: 61,
};

const EXTRA_BUTTON_NOTES: Record<(typeof EXTRA_BUTTON_IDS)[number], number> = {
  track: 40,
  eq: 44,
  plugin: 43,
  instrument: 45,
  "global-view": 51,
  "midi-tracks": 62,
  inputs: 63,
  "audio-tracks": 64,
  "audio-instruments": 65,
  aux: 66,
  buses: 67,
  outputs: 68,
  user: 69,
  "name-value": 52,
  "smpte-beats": 53,
  "read-off": 74,
  write: 75,
  trim: 76,
  touch: 77,
  latch: 78,
  group: 79,
  save: 80,
  undo: 81,
  cancel: 82,
  enter: 83,
  marker: 84,
  nudge: 85,
  cycle: 86,
  drop: 87,
  replace: 88,
  click: 89,
  "rude-solo": 90,
  rewind: 91,
  forward: 92,
  stop: 93,
  play: 94,
  record: 95,
  "nav-up": 96,
  "nav-down": 97,
  "nav-left": 98,
  "nav-right": 99,
  scrub: 101,
};

const LABELS: Record<ButtonId, string> = {
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

export const BUTTON_DEFINITIONS: Record<ButtonId, ButtonDefinition> = Object.fromEntries(
  BUTTON_IDS.map((id) => [
    id,
    {
      id,
      label: LABELS[id],
      note: (FUNCTION_BUTTON_NOTES as Record<string, number>)[id] ?? EXTRA_BUTTON_NOTES[id as keyof typeof EXTRA_BUTTON_NOTES],
    },
  ]),
) as Record<ButtonId, ButtonDefinition>;

const NOTE_TO_BUTTON = new Map<number, ButtonId>(
  BUTTON_IDS.map((id) => [BUTTON_DEFINITIONS[id].note, id]),
);

export function isButtonId(value: string): value is ButtonId {
  return (BUTTON_IDS as readonly string[]).includes(value);
}

export function buttonNote(id: ButtonId): number {
  return BUTTON_DEFINITIONS[id].note;
}

export function buttonLabel(id: ButtonId): string {
  return BUTTON_DEFINITIONS[id].label;
}

/** Returns the assignable button for an MCU note, or `null` when the note is reserved. */
export function buttonForNote(note: number): ButtonId | null {
  return NOTE_TO_BUTTON.get(note) ?? null;
}
