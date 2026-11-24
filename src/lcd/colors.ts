export const LCD_COLORS = [
  "off",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

export type LcdColor = (typeof LCD_COLORS)[number];

export const LCD_COLOR_CODES: Record<LcdColor, number> = {
  off: 0x00,
  red: 0x01,
  green: 0x02,
  yellow: 0x03,
  blue: 0x04,
  magenta: 0x05,
  cyan: 0x06,
  white: 0x07,
};

export const LCD_COLOR_LABELS: Record<LcdColor, string> = {
  off: "Aus",
  red: "Rot",
  green: "Grün",
  yellow: "Gelb",
  blue: "Blau",
  magenta: "Magenta",
  cyan: "Cyan",
  white: "Weiß",
};

export function isLcdColor(value: unknown): value is LcdColor {
  return typeof value === "string" && (LCD_COLORS as readonly string[]).includes(value);
}
