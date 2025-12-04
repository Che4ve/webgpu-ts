export type RGB = [number, number, number];

// Convert hex color string (#rrggbb or rrggbb) to 0..1 range tuple
export function hexToRgb01(hex: string): RGB {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = Number.parseInt(value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r / 255, g / 255, b / 255];
}
