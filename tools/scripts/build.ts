import { message, translateMessage } from "../../shared/i18n/message.ts";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseThemeManifest,
  parseHostedAssets,
  validateTheme,
  type Theme,
  type ThemeContract,
} from "../../shared/contracts/theme.ts";
import { parseImagePrompts } from "../../shared/theme/prompts.ts";
import { readScriptCatalog, projectRoot } from "./catalog.ts";
import { bundleScript } from "./bundle.ts";
import { readBuildArguments } from "./arguments.ts";

const identifier = /^[a-z][a-z0-9-]*$/;
async function main(): Promise<void> {
  const catalog = await readScriptCatalog();
  const themeDirectories = await readdir(path.join(projectRoot, "themes"), {
    withFileTypes: true,
  });
  const values = readBuildArguments(
    themeDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    catalog.modules.map((source) => source.manifest.id),
  );
  if (values.help) {
    console.log(`Usage: npm run build:scripts [--theme <theme-id>] [--feature <feature-id>]

Omit --theme to build all themes; omit --feature to build all implemented features.
Output: dist/scripts/<theme-id>/<presets|characters>/<feature-id>.json`);
    return;
  }
  for (const [name, value] of Object.entries({
    theme: values.theme,
    feature: values.feature,
  })) {
    if (value !== undefined && !identifier.test(value))
      throw new Error(`Invalid ${name} identifier: ${value}`);
  }
  const sources = catalog.modules.filter(
    (source) => !values.feature || source.manifest.id === values.feature,
  );
  if (values.feature && !sources.length)
    throw new Error(`Feature is unknown or not implemented: ${values.feature}`);
  const contract: ThemeContract = JSON.parse(
    await readFile(path.join(projectRoot, "themes/contract.json"), "utf8"),
  );
  const dictionary: Record<string, string> = JSON.parse(
    await readFile(path.join(projectRoot, "locales/zh-CN.json"), "utf8"),
  );
  let completedCount = 0;
  const themes: Theme[] = [];
  for (const entry of themeDirectories) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(projectRoot, "themes", entry.name);
    const theme: Theme = {
      manifest: parseThemeManifest(
        JSON.parse(await readFile(path.join(directory, "theme.json"), "utf8")),
      ),
      palette: await readFile(path.join(directory, "palette.css"), "utf8"),
      assets: parseHostedAssets(
        JSON.parse(await readFile(path.join(directory, "images.json"), "utf8")),
      ),
      prompts: parseImagePrompts(
        await readFile(path.join(directory, "prompt.md"), "utf8"),
      ),
    };
    validateTheme(theme, contract, entry.name);
    // Authoring prompts and other themes never enter an independent script.
    if (!values.theme || theme.manifest.id === values.theme)
      themes.push({ ...theme, prompts: {} });
  }
  if (!themes.length)
    throw new Error(`Unknown theme: ${values.theme ?? "(none)"}`);
  themes.sort((left, right) => left.manifest.order - right.manifest.order);
  if (!sources.length)
    console.warn("No business features are implemented yet.");
  const baseCss = await readFile(
    path.join(projectRoot, "themes/base.css"),
    "utf8",
  );
  const output = path.join(projectRoot, "dist/scripts");
  const artifacts: { file: string; content: string }[] = [];
  for (const theme of themes) {
    for (const source of sources) {
      const owner = catalog.profiles.find((profile) =>
        profile.modules.includes(source.manifest.id),
      )!;
      const packaged = await bundleScript(source, owner, theme, baseCss);
      artifacts.push({
        file: path.join(
          theme.manifest.id,
          owner.target === "preset" ? "presets" : "characters",
          `${source.manifest.id}.json`,
        ),
        content: `${JSON.stringify(packaged, null, 2)}\n`,
      });
      completedCount++;
    }
  }
  // Compile everything in memory before refreshing the selected output scope.
  if (!values.theme && !values.feature) {
    await rm(output, { recursive: true, force: true });
  } else if (!values.feature) {
    for (const theme of themes)
      await rm(path.join(output, theme.manifest.id), {
        recursive: true,
        force: true,
      });
  } else {
    for (const theme of themes)
      for (const carrier of ["presets", "characters"])
        await rm(
          path.join(
            output,
            theme.manifest.id,
            carrier,
            `${values.feature}.json`,
          ),
          { force: true },
        );
  }
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, artifact.content);
  }
  console.log(
    translateMessage(
      message("loreloom.build.summary", "Built {count} scripts."),
      dictionary,
      { count: completedCount },
    ),
  );
  console.log(`Scripts saved to ${output}`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
