import type { ModuleManifest } from "../../shared/contracts/module.ts";
import type { ThemeManifest } from "../../shared/contracts/theme.ts";
export function packageScript(
  module: ModuleManifest,
  theme: ThemeManifest,
  content: string,
) {
  if (!content.trim()) throw new Error("Cannot package an empty script.");
  return {
    type: "script" as const,
    enabled: true,
    name: `${module.name["zh-CN"]}-${theme.name["zh-CN"]}`,
    id: module.scriptId,
    content,
    info: `Loreloom ${module.id}; theme: ${theme.id}.`,
    button: {
      enabled: !!module.buttons?.length,
      buttons: module.buttons ?? [],
    },
    data: {},
    export_with: { data: true, button: true },
  };
}
