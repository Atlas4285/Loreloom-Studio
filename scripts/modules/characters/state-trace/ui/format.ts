export function formatStateNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(value)) return String(value);
  if (magnitude < 1000) {
    const text = String(value);
    if (text.length <= 8) return text;
    const rounded = Number(value.toPrecision(3));
    return Math.abs(rounded) >= 1000
      ? formatStateNumber(rounded)
      : String(rounded);
  }
  const units = ["", "K", "M", "B", "T"];
  let unit = Math.min(Math.floor(Math.log10(magnitude) / 3), units.length - 1);
  let scaled = magnitude / 1000 ** unit;
  let decimals = Math.max(0, 2 - Math.floor(Math.log10(scaled)));
  if (Number(scaled.toFixed(decimals)) >= 1000) {
    if (unit === units.length - 1) return value.toExponential(2);
    scaled = magnitude / 1000 ** ++unit;
    decimals = Math.max(0, 2 - Math.floor(Math.log10(Math.max(1, scaled))));
  }
  return `${value < 0 ? "-" : ""}${scaled.toFixed(decimals)}${units[unit]}`;
}
