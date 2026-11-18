export function formatTokens(value: number): string {
  const count = Math.max(0, Math.round(value));
  if (count < 1000) return String(count);

  const units = ["", "K", "M", "B", "T"];
  let unit = Math.min(Math.floor(Math.log10(count) / 3), units.length - 1);
  let scaled = count / 1000 ** unit;
  let decimals = Math.max(0, 2 - Math.floor(Math.log10(scaled)));
  let rounded = Number(scaled.toFixed(decimals));
  if (rounded >= 1000 && unit < units.length - 1) {
    unit += 1;
    scaled = count / 1000 ** unit;
    decimals = Math.max(0, 2 - Math.floor(Math.log10(Math.max(1, scaled))));
    rounded = Number(scaled.toFixed(decimals));
  }
  return `${rounded.toFixed(decimals)}${units[unit]}`;
}
