import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
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
import { parseCharacterMarkdown } from "./markdown.ts";
import { readCharacterArguments } from "./arguments.ts";
import { packageCharacter } from "./package.ts";
import { selectCharacterScripts } from "./script-config.ts";

async function main(): Promise<void> {
  const directory = path.join(projectRoot, "characters");
  const available = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const catalog = await readScriptCatalog();
  const profile = catalog.profiles.find((item) => item.id === "character")!;
  const themeIds = (
    await readdir(path.join(projectRoot, "themes"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const selected = readCharacterArguments(themeIds, available, profile.modules);
  if (selected.help) {
    console.log(
      "Usage: npm run build:characters [--character <filename or stem>] [--theme <theme-id>] [--scripts <id,id|none>]\nDefaults: all characters, all themes, scripts declared in each card's ScriptConfig.\n--scripts adds scripts after configured scripts, without duplicates; none disables all scripts.\nAvailable scripts: " +
        profile.modules.join(", ") +
        "\nOutput: dist/characters/<theme-id>/<character-name>-<theme-name>.json",
    );
    return;
  }
  if (!available.length) throw new Error("No character Markdown files found.");
  const files =
    selected.character === undefined
      ? available
      : available.filter(
          (file) =>
            file === selected.character ||
            path.parse(file).name === selected.character,
        );
  if (selected.character !== undefined && files.length !== 1)
    throw new Error(
      `Unknown or ambiguous character: ${selected.character}. Available: ${available.join(", ")}`,
    );
  const modules = new Map(
    catalog.modules.map((source) => [source.manifest.id, source]),
  );
  const drafts = await Promise.all(
    files.map(async (filename) => {
      try {
        const draft = parseCharacterMarkdown(
          await readFile(path.join(directory, filename), "utf8"),
        );
        return {
          filename,
          ...draft,
          scriptIds: selectCharacterScripts(
            Object.keys(draft.scriptData),
            selected.scripts,
            profile.modules,
          ),
        };
      } catch (error) {
        throw new Error(
          `${filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  if (new Set(drafts.map((draft) => draft.name)).size !== drafts.length)
    throw new Error("Character titles must be unique.");
  const ids = [...new Set(drafts.flatMap((draft) => draft.scriptIds))];
  const requested = selected.theme;
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
  const output = path.join(projectRoot, "dist/characters");
  const artifacts: { file: string; content: string }[] = [];
  for (const theme of themes) {
    const scripts = new Map<string, Awaited<ReturnType<typeof bundleScript>>>();
    for (const id of ids)
      scripts.set(
        id,
        await bundleScript(modules.get(id)!, profile, theme, baseCss),
      );
    for (const draft of drafts) {
      const result = packageCharacter(
        draft,
        draft.filename,
        theme.manifest.id,
        draft.scriptIds.map((id) => {
          const script = structuredClone(scripts.get(id)!);
          Object.assign(
            script.data,
            structuredClone(draft.scriptData[id] ?? {}),
          );
          return script;
        }),
      );
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
  // Compile every selected artifact before replacing any finished character.
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
  console.log(
    `Built ${artifacts.length} character cards.\nCharacters saved to ${output}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
