import { parseArgs } from "node:util";

export function readCharacterArguments(
  themeIds: string[],
  filenames: string[],
  scriptIds: string[],
) {
  const { values, positionals } = parseArgs({
    options: {
      character: { type: "string" },
      theme: { type: "string" },
      scripts: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help) return values;
  const result = { ...values };
  const pending: ("character" | "theme" | "scripts")[] = [];
  for (const key of ["character", "theme", "scripts"] as const) {
    if (result[key] !== undefined) continue;
    const value = process.env[`npm_config_${key}`];
    if (value === undefined) continue;
    if (value === "true") pending.push(key);
    else if (!value || value === "false")
      throw new Error(`--${key} requires a value.`);
    else result[key] = value;
  }
  if (positionals.length !== pending.length)
    throw new Error(
      "Each option requires one value; unexpected positional arguments are not accepted.",
    );
  if (pending.length === 1) result[pending[0]] = positionals[0];
  if (pending.length > 1) {
    const candidates: (typeof result)[] = [];
    const matches = (key: string, value: string) =>
      key === "theme"
        ? themeIds.includes(value)
        : key === "character"
          ? filenames.some(
              (file) => file === value || file.replace(/\.md$/, "") === value,
            )
          : value === "none" ||
            value.split(",").every((id) => scriptIds.includes(id.trim()));
    const visit = (
      index: number,
      remaining: string[],
      candidate: typeof result,
    ) => {
      if (index === pending.length) {
        candidates.push(candidate);
        return;
      }
      const key = pending[index];
      remaining.forEach((value, i) => {
        if (matches(key, value))
          visit(
            index + 1,
            remaining.filter((_, j) => i !== j),
            { ...candidate, [key]: value },
          );
      });
    };
    visit(0, positionals, result);
    const unique = [
      ...new Map(
        candidates.map((candidate) => [JSON.stringify(candidate), candidate]),
      ).values(),
    ];
    if (unique.length !== 1)
      throw new Error(
        "Cannot identify option values. Use --character=<name>, --theme=<id> and --scripts=<ids>, or forward options after --.",
      );
    Object.assign(result, unique[0]);
  }
  for (const key of ["character", "theme", "scripts"] as const)
    if (result[key] !== undefined && !result[key]?.trim())
      throw new Error(`--${key} requires a value.`);
  return result;
}
