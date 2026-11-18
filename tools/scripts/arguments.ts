import { parseArgs } from "node:util";

export interface BuildArguments {
  theme?: string;
  feature?: string;
  help?: boolean;
}

export function readBuildArguments(
  themeIds: readonly string[],
  featureIds: readonly string[],
): BuildArguments {
  const { values, positionals } = parseArgs({
    options: {
      theme: { type: "string" },
      feature: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  const result: BuildArguments = { ...values };
  const pending: ("theme" | "feature")[] = [];
  for (const key of ["theme", "feature"] as const) {
    if (result[key] !== undefined) continue;
    // npm 10 consumes unseparated flags and forwards their values as positionals.
    const configured = process.env[`npm_config_${key}`];
    if (configured === undefined) continue;
    if (configured === "true") pending.push(key);
    else if (!configured || configured === "false")
      throw new Error(`--${key} requires a value.`);
    else result[key] = configured;
  }
  if (positionals.length !== pending.length) {
    throw new Error(
      "Each --theme or --feature option requires one value; unexpected positional arguments are not accepted.",
    );
  }
  if (pending.length === 1) result[pending[0]] = positionals[0];
  if (pending.length === 2) {
    const candidates = [
      { theme: positionals[0], feature: positionals[1] },
      { theme: positionals[1], feature: positionals[0] },
    ];
    const knownThemes = candidates.filter((candidate) =>
      themeIds.includes(candidate.theme),
    );
    const knownFeatures = knownThemes.filter((candidate) =>
      featureIds.includes(candidate.feature),
    );
    const matching = knownFeatures.length ? knownFeatures : knownThemes;
    const unique = [
      ...new Map(
        matching.map((candidate) => [JSON.stringify(candidate), candidate]),
      ).values(),
    ];
    if (unique.length !== 1) {
      throw new Error(
        "Cannot identify theme and feature values. Use npm run build:scripts --theme=<theme-id> --feature=<feature-id> to make the assignment explicit.",
      );
    }
    Object.assign(result, unique[0]);
  }
  return result;
}
