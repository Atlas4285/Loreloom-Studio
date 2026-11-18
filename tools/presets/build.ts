import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  parseThemeManifest,
  parseHostedAssets,
  validateTheme,
  type Theme,
  type ThemeContract,
} from "../../shared/contracts/theme.ts";
import { parseImagePrompts } from "../../shared/theme/prompts.ts";
import { bundleScript } from "../scripts/bundle.ts";
import { projectRoot, readScriptCatalog } from "../scripts/catalog.ts";
import { parsePresetMarkdown } from "./markdown.ts";

function scriptId(filename: string, theme: string, source: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.from("966ca762af685e6a986bfd9519a14668", "hex"))
    .update(JSON.stringify([filename, theme, source]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      theme: { type: "string" },
      preset: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    console.log(
      "Usage: npm run build:presets [--preset <name or filename>] [--theme <theme-id>]\nOutput: dist/presets/<theme-id>/<preset-name>-<theme-name>.json",
    );
    return;
  }
  const directory = path.join(projectRoot, "presets");
  const available = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  if (!available.length) throw new Error("No preset Markdown files found.");
  const selected: { theme?: string; preset?: string } = {
    theme: values.theme,
    preset: values.preset,
  };
  const pending: ("theme" | "preset")[] = [];
  for (const key of ["theme", "preset"] as const) {
    if (selected[key] !== undefined) continue;
    const configured = process.env[`npm_config_${key}`];
    if (configured === undefined) continue;
    if (configured === "true") pending.push(key);
    else if (!configured || configured === "false")
      throw new Error(`--${key} requires a value.`);
    else selected[key] = configured;
  }
  if (positionals.length !== pending.length)
    throw new Error(
      "Each option requires one value; unexpected positional arguments are not accepted.",
    );
  const matchesPreset = (filename: string, name: string) =>
    filename === name || path.parse(filename).name === name;
  if (pending.length === 1) selected[pending[0]] = positionals[0];
  if (pending.length === 2) {
    // npm 10 consumes flags; infer their positional values without requiring flag order.
    const themeIds = (
      await readdir(path.join(projectRoot, "themes"), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const candidates = [
      { theme: positionals[0], preset: positionals[1] },
      { theme: positionals[1], preset: positionals[0] },
    ].filter(
      (candidate) =>
        themeIds.includes(candidate.theme) &&
        available.some((filename) => matchesPreset(filename, candidate.preset)),
    );
    const unique = [
      ...new Map(
        candidates.map((candidate) => [JSON.stringify(candidate), candidate]),
      ).values(),
    ];
    if (unique.length !== 1)
      throw new Error(
        "Cannot identify preset and theme values. Use --preset=<name> and --theme=<theme-id> to make them explicit.",
      );
    Object.assign(selected, unique[0]);
  }
  for (const key of ["theme", "preset"] as const)
    if (selected[key] !== undefined && !selected[key]?.trim())
      throw new Error(`--${key} requires a value.`);
  const requested = selected.theme;
  const files =
    selected.preset === undefined
      ? available
      : available.filter((filename) =>
          matchesPreset(filename, selected.preset!),
        );
  if (selected.preset !== undefined && files.length !== 1)
    throw new Error(
      `Unknown or ambiguous preset: ${selected.preset}. Available: ${available.join(", ")}`,
    );
  const drafts = await Promise.all(
    files.map(async (filename) => ({
      filename,
      ...parsePresetMarkdown(
        await readFile(path.join(directory, filename), "utf8"),
      ),
    })),
  );
  if (new Set(drafts.map((draft) => draft.name)).size !== drafts.length)
    throw new Error("Preset titles must be unique.");
  const catalog = await readScriptCatalog();
  const profile = catalog.profiles.find((item) => item.id === "preset")!;
  const modules = new Map(
    catalog.modules.map((source) => [source.manifest.id, source]),
  );
  for (const draft of drafts)
    for (const id of draft.scripts) {
      if (!profile.modules.includes(id) || !modules.has(id))
        throw new Error(`Unknown or non-preset script: ${id}`);
    }
  const contract: ThemeContract = JSON.parse(
    await readFile(path.join(projectRoot, "themes/contract.json"), "utf8"),
  );
  const themes: Theme[] = [];
  for (const entry of await readdir(path.join(projectRoot, "themes"), {
    withFileTypes: true,
  })) {
    if (
      !entry.isDirectory() ||
      (requested !== undefined && entry.name !== requested)
    )
      continue;
    const location = path.join(projectRoot, "themes", entry.name);
    const theme: Theme = {
      manifest: parseThemeManifest(
        JSON.parse(await readFile(path.join(location, "theme.json"), "utf8")),
      ),
      palette: await readFile(path.join(location, "palette.css"), "utf8"),
      assets: parseHostedAssets(
        JSON.parse(await readFile(path.join(location, "images.json"), "utf8")),
      ),
      prompts: parseImagePrompts(
        await readFile(path.join(location, "prompt.md"), "utf8"),
      ),
    };
    validateTheme(theme, contract, entry.name);
    themes.push({ ...theme, prompts: {} });
  }
  if (!themes.length)
    throw new Error(`Unknown theme: ${requested ?? "(none)"}`);
  themes.sort((a, b) => a.manifest.order - b.manifest.order);
  const baseCss = await readFile(
    path.join(projectRoot, "themes/base.css"),
    "utf8",
  );
  const output = path.join(projectRoot, "dist/presets");
  const artifacts: { file: string; content: string }[] = [];
  for (const theme of themes) {
    const scripts = new Map<string, Awaited<ReturnType<typeof bundleScript>>>();
    for (const id of new Set(drafts.flatMap((draft) => draft.scripts)))
      scripts.set(
        id,
        await bundleScript(modules.get(id)!, profile, theme, baseCss),
      );
    for (const draft of drafts) {
      const result = structuredClone(draft.preset);
      result.extensions = {
        tavern_helper: {
          scripts: draft.scripts.map((id) => {
            const script = scripts.get(id)!;
            return {
              ...script,
              id: scriptId(
                draft.filename.replace(/\.md$/, ".json"),
                theme.manifest.id,
                script.id,
              ),
            };
          }),
          variables: {},
        },
      };
      const file = path.join(
        theme.manifest.id,
        `${draft.name}-${theme.manifest.name["zh-CN"]}.json`,
      );
      artifacts.push({
        file,
        content: `${JSON.stringify(result, null, 4)}\n`,
      });
    }
  }
  // Compile every selected artifact before replacing any finished preset.
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.file);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, artifact.content, "utf8");
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  console.log(`Built ${artifacts.length} presets.\nPresets saved to ${output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
