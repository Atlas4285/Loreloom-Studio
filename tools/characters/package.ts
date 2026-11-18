import { createHash } from "node:crypto";
import type { CharacterSource } from "./markdown.ts";
import type { bundleScript } from "../scripts/bundle.ts";

type Script = Awaited<ReturnType<typeof bundleScript>>;
function scriptId(filename: string, theme: string, source: string) {
  const bytes = createHash("sha1")
    .update(Buffer.from("966ca762af685e6a986bfd9519a14668", "hex"))
    .update(JSON.stringify(["character", filename, theme, source]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function packageCharacter(
  draft: CharacterSource,
  filename: string,
  theme: string,
  scripts: Script[],
) {
  const data = structuredClone(draft.data);
  const extensions = data.extensions as Record<string, unknown>;
  extensions.tavern_helper = {
    scripts: scripts.map((script) => ({
      ...script,
      id: scriptId(filename.replace(/\.md$/, ".json"), theme, script.id),
    })),
    variables: {},
  };
  return {
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    creatorcomment: data.creator_notes,
    avatar: "none",
    talkativeness: extensions.talkativeness,
    fav: extensions.fav,
    tags: structuredClone(data.tags),
    spec: "chara_card_v3",
    spec_version: "3.0",
    data,
  };
}
