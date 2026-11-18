import ts from "typescript";
import { parseMarkdownDocument, type Section } from "../markdown.ts";
import { createScriptData } from "./script-config.ts";
import { parseWorldBook } from "./world-book.ts";

const textFields = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function block(section: Section, language: string, subsection = "") {
  const blocks = section.blocks.filter((item) => item.section === subsection);
  if (blocks.length !== 1 || blocks[0].language !== language)
    throw new Error(
      `Expected one ${language} block in ${section.name}/${subsection}.`,
    );
  return blocks[0].text;
}
export interface CharacterSource {
  name: string;
  data: Record<string, unknown>;
  scriptData: Record<string, Record<string, unknown>>;
}
export function parseCharacterMarkdown(source: string): CharacterSource {
  const { name, sections } = parseMarkdownDocument(source);
  const allowed = new Set<string>([
    "Settings",
    ...textFields,
    "depth_prompt",
    "alternate_greetings",
    "character_book",
    "ScriptConfig",
  ]);
  for (const section of sections)
    if (!allowed.has(section.name))
      throw new Error(
        `Unknown character section: ${section.name}. Declare scripts in ScriptConfig or add them with --scripts.`,
      );
  const settings = sections.find((section) => section.name === "Settings");
  if (
    !settings ||
    settings.blocks.length !== 1 ||
    settings.blocks[0].section ||
    !["json", "jsonc"].includes(settings.blocks[0].language)
  )
    throw new Error("Settings requires one JSON or JSONC block.");
  const parsed =
    settings.blocks[0].language === "jsonc"
      ? ts.parseConfigFileTextToJson("character.jsonc", settings.blocks[0].text)
      : { config: JSON.parse(settings.blocks[0].text) as unknown };
  if (parsed.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
    );
  const config: unknown = parsed.config;
  if (
    !record(config) ||
    Object.keys(config).some(
      (key) =>
        !["creator", "character_version", "tags", "extensions"].includes(key),
    )
  )
    throw new Error(
      "Settings only supports creator, character_version, tags and extensions.",
    );
  for (const key of ["creator", "character_version"])
    if (config[key] !== undefined && typeof config[key] !== "string")
      throw new Error(`${key} must be a string.`);
  if (
    config.tags !== undefined &&
    (!Array.isArray(config.tags) ||
      !config.tags.every((tag) => typeof tag === "string"))
  )
    throw new Error("Tags must be an array of strings.");
  if (config.extensions !== undefined && !record(config.extensions))
    throw new Error("Extensions must be an object.");
  const extensions = {
    talkativeness: "0.5",
    fav: false,
    world: "",
    ...(config.extensions as Record<string, unknown> | undefined),
  };
  if (
    Object.hasOwn(extensions, "tavern_helper") ||
    Object.hasOwn(extensions, "depth_prompt")
  )
    throw new Error(
      "tavern_helper and depth_prompt extensions are generated fields.",
    );
  if (extensions.world !== "")
    throw new Error(
      "extensions.world is generated from character_book.name; configure the world book in character_book.",
    );
  if (typeof extensions.fav !== "boolean")
    throw new Error("fav must be a boolean.");
  const talk = extensions.talkativeness;
  if (
    !["string", "number"].includes(typeof talk) ||
    String(talk).trim() === "" ||
    !Number.isFinite(Number(talk)) ||
    Number(talk) < 0 ||
    Number(talk) > 1
  )
    throw new Error(
      "talkativeness must be a number or numeric string between 0 and 1.",
    );
  const data: Record<string, unknown> = {
    name,
    creator: "",
    character_version: "",
    tags: [],
    ...config,
    extensions,
  };
  for (const field of textFields) {
    const section = sections.find((item) => item.name === field);
    if (section && section.blocks.length !== 1)
      throw new Error(`${field} requires one text block.`);
    data[field] = section ? block(section, "text") : "";
  }
  const depth = sections.find((section) => section.name === "depth_prompt");
  let depthPrompt = { prompt: "", depth: 4, role: "system" };
  if (depth) {
    if (depth.blocks.length !== 2)
      throw new Error("depth_prompt requires metadata and content blocks.");
    const metadata: unknown = JSON.parse(block(depth, "json", "metadata"));
    if (
      !record(metadata) ||
      Object.keys(metadata).some((key) => !["depth", "role"].includes(key)) ||
      !Number.isSafeInteger(metadata.depth) ||
      Number(metadata.depth) < 0 ||
      !["system", "user", "assistant"].includes(String(metadata.role))
    )
      throw new Error("Invalid depth prompt metadata.");
    depthPrompt = {
      prompt: block(depth, "text", "content"),
      depth: Number(metadata.depth),
      role: String(metadata.role),
    };
  }
  Object.assign(extensions, { depth_prompt: depthPrompt });
  const greetings = sections.find(
    (section) => section.name === "alternate_greetings",
  );
  const titles = new Set<string>();
  data.alternate_greetings = (greetings?.blocks ?? []).map((item) => {
    if (item.language !== "text" || !item.section || titles.has(item.section))
      throw new Error(
        "Alternate greetings need distinct headings with one text block each.",
      );
    titles.add(item.section);
    return item.text;
  });
  const worldBook = sections.find(
    (section) => section.name === "character_book",
  );
  if (worldBook) {
    const book = parseWorldBook(worldBook);
    data.character_book = book;
    extensions.world = book.name;
  }
  const scriptData: CharacterSource["scriptData"] = {};
  const scriptConfig = sections.find(
    (section) => section.name === "ScriptConfig",
  );
  for (const item of scriptConfig?.blocks ?? []) {
    const id = item.section;
    if (!id || !["json", "jsonc"].includes(item.language))
      throw new Error(
        "ScriptConfig requires script ID headings with one JSON or JSONC block each.",
      );
    if (Object.hasOwn(scriptData, id))
      throw new Error(`Duplicate script configuration: ${id}`);
    try {
      const parsed =
        item.language === "jsonc"
          ? ts.parseConfigFileTextToJson(`${id}.jsonc`, item.text)
          : { config: JSON.parse(item.text) as unknown };
      if (parsed.error)
        throw new Error(
          ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
        );
      Object.defineProperty(scriptData, id, {
        value: createScriptData(id, parsed.config),
        enumerable: true,
      });
    } catch (error) {
      throw new Error(
        `ScriptConfig/${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { name, data, scriptData };
}
