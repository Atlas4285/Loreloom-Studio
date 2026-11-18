import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseModuleManifest,
  parseProfile,
  selectModules,
  type ModuleManifest,
  type Profile,
} from "../../shared/contracts/module.ts";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export interface ModuleSource {
  manifest: ModuleManifest;
  entry: string;
}
export async function readScriptCatalog(): Promise<{
  profiles: Profile[];
  modules: ModuleSource[];
}> {
  const modules: ModuleSource[] = [];
  async function discover(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await discover(location);
      else if (entry.isFile() && entry.name === "module.json") {
        const manifest = parseModuleManifest(
          JSON.parse(await readFile(location, "utf8")),
        );
        if (path.basename(directory) !== manifest.id)
          throw new Error(`Module directory differs from ID: ${location}`);
        const source = path.join(directory, "index.ts");
        if (!(await stat(source)).isFile())
          throw new Error(`Module entry missing: ${source}`);
        modules.push({ manifest, entry: source });
      }
    }
  }
  await discover(path.join(projectRoot, "scripts/modules"));
  const profiles: Profile[] = [];
  for (const id of ["preset", "character"]) {
    const profile = parseProfile(
      JSON.parse(
        await readFile(
          path.join(projectRoot, "scripts/profiles", `${id}.json`),
          "utf8",
        ),
      ),
    );
    if (profile.id !== id)
      throw new Error(`Profile filename differs from ID: ${id}`);
    selectModules(
      profile,
      modules.map((module) => module.manifest),
    );
    profiles.push(profile);
  }
  if (
    new Set(modules.map((module) => module.manifest.scriptId)).size !==
    modules.length
  )
    throw new Error("Module script IDs must be unique.");
  for (const module of modules) {
    const owners = profiles.filter((profile) =>
      profile.modules.includes(module.manifest.id),
    );
    if (owners.length !== 1)
      throw new Error(
        `Module must belong to exactly one carrier profile: ${module.manifest.id}`,
      );
  }
  return { profiles, modules };
}
