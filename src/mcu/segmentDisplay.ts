/**
 * Encoder for the X-Touch main-unit seven-segment displays.
 *
 * MC mode addresses the ten timecode digits and the two assignment digits with
 * one Control Change per digit, counted from the right:
 *
 * | Display              | Rightmost     | Leftmost      |
 * | -------------------- | ------------- | ------------- |
 * | Timecode, 10 digits  | CC `0x40` (64) | CC `0x49` (73) |
 * | Assignment, 2 digits | CC `0x4A` (74) | CC `0x4B` (75) |
 *
 * The value carries the character code; adding `0x40` lights the decimal point
 * of that digit without consuming an extra position. Digits `0`-`9` use
 * `0x30`-`0x39`, `A`-`Z` use `0x01`-`0x1A` and `-` uses `0x2D`. Everything
 * else renders blank (`0x20`).
 *
 * Sources: Behringer X-Touch product data, the Mackie Control protocol
 * reference (TouchMCU), Cubase's X-Touch MIDI Remote script and ReaLearn's
 * seven-segment encoder. The byte mapping is documented in
 * `docs/protocols/XTouch_USB_MCU_Referenz.md` and `docs/research.md`.
 */

export const MCU_SEGMENT_DIGITS = 10;
export const MCU_SEGMENT_ASSIGNMENT_DIGITS = 2;
/** Control Change number of the rightmost timecode digit. */
export const MCU_SEGMENT_CC_TIME_BASE = 0x40;
/**
 * Control Change number of the rightmost assignment digit. The bridge never
 * writes this pair: the assignment display stays under device control.
 */
export const MCU_SEGMENT_CC_ASSIGNMENT_BASE = 0x4a;

export const SEGMENT_BLANK = 0x20;
const SEGMENT_DOT = 0x40;

export interface SegmentCell {
  /** Single character; `" "` renders blank. */
  character: string;
  /** Lights the decimal point of this digit. */
  dot: boolean;
}

export interface SegmentUpdate {
  /** Cell index left to right. */
  index: number;
  /** Control Change number for this digit. */
  cc: number;
  value: number;
}

export interface SegmentUpdatePlan {
  updates: SegmentUpdate[];
  /** Fully encoded frame, left to right. */
  values: number[];
}

export function blankSegmentCells(width = MCU_SEGMENT_DIGITS): SegmentCell[] {
  return Array.from({ length: width }, () => ({ character: " ", dot: false }));
}

/**
 * MCU seven-segment character code. Unknown characters render blank instead of
 * showing a misleading glyph.
 */
export function sevenSegmentCode(character: string): number {
  const upper = character.toUpperCase();
  if (Array.from(upper).length !== 1) return SEGMENT_BLANK;
  const code = upper.codePointAt(0) ?? 0;
  if (code >= 0x30 && code <= 0x39) return code; // 0-9
  if (code >= 0x41 && code <= 0x5a) return code - 0x40; // A-Z -> 0x01-0x1A
  if (upper === "-") return 0x2d;
  return SEGMENT_BLANK;
}

/**
 * Splits text into cells. A `.` lights the dot of the preceding cell and does
 * not consume a position. Text is right-aligned; longer text keeps its
 * rightmost characters, matching how timecode is written to the display.
 */
export function segmentCellsFromText(text: string, width = MCU_SEGMENT_DIGITS): SegmentCell[] {
  const cells: SegmentCell[] = [];
  for (const character of text) {
    if (character === ".") {
      const previous = cells[cells.length - 1];
      if (previous) previous.dot = true;
      continue;
    }
    cells.push({ character, dot: false });
  }
  if (cells.length > width) cells.splice(0, cells.length - width);
  while (cells.length < width) cells.unshift({ character: " ", dot: false });
  return cells;
}

function cellValue(cell: SegmentCell): number {
  const code = sevenSegmentCode(cell.character);
  return cell.dot ? Math.min(0x7f, code + SEGMENT_DOT) : code;
}

/**
 * Compares the desired frame with the previously written values and returns
 * only the digits that changed. A `null` previous frame writes all digits.
 */
export function segmentUpdatePlan(
  cells: readonly SegmentCell[],
  previous: readonly number[] | null,
  firstCc = MCU_SEGMENT_CC_TIME_BASE,
): SegmentUpdatePlan {
  const width = cells.length;
  const values = cells.map(cellValue);
  const updates: SegmentUpdate[] = [];
  for (let index = 0; index < width; index += 1) {
    const value = values[index] ?? SEGMENT_BLANK;
    if (previous !== null && previous[index] === value) continue;
    updates.push({ index, cc: firstCc + (width - 1 - index), value });
  }
  return { updates, values };
}
