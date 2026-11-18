import contract from "../../themes/contract.json";
import { parseImagePrompts } from "../../shared/theme/prompts";
import {
  parseThemeManifest,
  parseHostedAssets,
  validateTheme,
  type Theme,
} from "../../shared/contracts/theme";

const manifests = import.meta.glob<unknown>("../../themes/*/theme.json", {
  eager: true,
  import: "default",
});
const palettes = import.meta.glob<string>("../../themes/*/palette.css", {
  eager: true,
  query: "?raw",
  import: "default",
});
const imageManifests = import.meta.glob<unknown>("../../themes/*/images.json", {
  eager: true,
  import: "default",
});
const promptFiles = import.meta.glob<string>("../../themes/*/prompt.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

export const themes: Theme[] = Object.entries(manifests)
  .map(([path, value]) => {
    const directory = path.slice(0, path.lastIndexOf("/"));
    const palette = palettes[`${directory}/palette.css`];
    if (!palette) throw new Error(`Missing palette: ${directory}`);
    const theme = {
      manifest: parseThemeManifest(value),
      palette,
      assets: parseHostedAssets(imageManifests[`${directory}/images.json`]),
      prompts: parseImagePrompts(promptFiles[`${directory}/prompt.md`] ?? ""),
    };
    validateTheme(theme, contract, directory.split("/").at(-1)!);
    return theme;
  })
  .sort(
    (a, b) =>
      a.manifest.order - b.manifest.order ||
      a.manifest.id.localeCompare(b.manifest.id),
  );

if (themes.length === 0) throw new Error("No themes are available.");

export { contract };
