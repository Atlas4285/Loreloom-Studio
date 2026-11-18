import path from "node:path";
import { build } from "vite";
import type { Profile } from "../../shared/contracts/module.ts";
import type { Theme } from "../../shared/contracts/theme.ts";
import { projectRoot, type ModuleSource } from "./catalog.ts";
import { packageScript } from "./package.ts";

export async function bundleScript(
  source: ModuleSource,
  owner: Profile,
  theme: Theme,
  baseCss: string,
) {
  const module = source.manifest;
  const themeId = theme.manifest.id;
  const profile = { ...owner, modules: [module.id] };
  const entry = `virtual:loreloom:${themeId}:${module.id}`;
  const resolvedEntry = `\0${entry}`;
  const content = `import setup from ${JSON.stringify(source.entry)};\nimport { startScripts } from ${JSON.stringify(path.join(projectRoot, "scripts/entry.ts"))};\nvoid startScripts({profile:${JSON.stringify(profile)},module:{...${JSON.stringify(module)},setup},theme:${JSON.stringify(theme)},baseCss:${JSON.stringify(baseCss)}}).catch(error=>console.error("Loreloom startup failed.",error));\n`;
  const moduleDirectory = path.dirname(source.entry);
  const modulesRoot = path.join(projectRoot, "scripts/modules") + path.sep;
  const result = await build({
    configFile: false,
    root: projectRoot,
    publicDir: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "warn",
    plugins: [
      {
        name: "loreloom-independent-feature",
        resolveId(id) {
          return id === entry ? resolvedEntry : null;
        },
        load(id) {
          if (id === resolvedEntry) return content;
          const file = id.split("?")[0];
          if (
            file.startsWith(modulesRoot) &&
            file !== moduleDirectory &&
            !file.startsWith(moduleDirectory + path.sep)
          )
            throw new Error(
              `Feature ${module.id} imports another feature. Move shared helpers to shared/ or use a service.`,
            );
          return null;
        },
      },
    ],
    build: {
      write: false,
      target: "es2022",
      minify: true,
      sourcemap: false,
      lib: { entry, name: "LoreloomScripts", formats: ["iife"] },
      rolldownOptions: { input: entry, output: { codeSplitting: false } },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0]))
    throw new Error("Unexpected script build output.");
  const bundle = bundles[0];
  const chunks = bundle.output.filter((item) => item.type === "chunk");
  if (
    bundle.output.length !== 1 ||
    chunks.length !== 1 ||
    chunks[0].imports.length ||
    chunks[0].dynamicImports.length
  )
    throw new Error(
      "A feature must compile to one self-contained JavaScript chunk.",
    );
  return packageScript(module, theme.manifest, chunks[0].code);
}
