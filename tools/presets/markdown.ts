import ts from "typescript";
import { parseMarkdownDocument } from "../markdown.ts";

export interface PresetSource {
  name: string;
  preset: Record<string, unknown>;
  scripts: string[];
}
const utilityFields: Record<string, string> = {
  "Impersonation prompt": "impersonation_prompt",
  "World Info format template": "wi_format",
  "Scenario format template": "scenario_format",
  "Personality format template": "personality_format",
  "Group Nudge prompt template": "group_nudge_prompt",
  "New Chat": "new_chat_prompt",
  "New Group Chat": "new_group_chat_prompt",
  "New Example Chat": "new_example_chat_prompt",
  "Continue nudge": "continue_nudge_prompt",
  "Replace empty message": "send_if_empty",
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function json(text: string, comments: boolean): unknown {
  if (!comments) return JSON.parse(text);
  const result = ts.parseConfigFileTextToJson("preset.jsonc", text);
  if (result.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, "\n"),
    );
  return result.config;
}

export function parsePresetMarkdown(source: string): PresetSource {
  const { name, sections } = parseMarkdownDocument(source);
  const settings = sections.find((section) => section.name === "Settings");
  if (
    !settings ||
    settings.blocks.length !== 1 ||
    settings.blocks[0].section ||
    !["json", "jsonc"].includes(settings.blocks[0].language)
  )
    throw new Error("Settings requires one JSON or JSONC block.");
  const parameters = json(
    settings.blocks[0].text,
    settings.blocks[0].language === "jsonc",
  );
  if (
    !record(parameters) ||
    ["prompts", "prompt_order", "extensions"].some((key) =>
      Object.hasOwn(parameters, key),
    )
  )
    throw new Error(
      "Settings must be an object without generated prompts, prompt_order or extensions.",
    );
  const scriptSection = sections.find((section) => section.name === "Scripts");
  let scripts: string[] = [];
  if (scriptSection) {
    if (
      scriptSection.blocks.length !== 1 ||
      scriptSection.blocks[0].language !== "json" ||
      scriptSection.blocks[0].section
    )
      throw new Error("Scripts requires one JSON block.");
    const value = json(scriptSection.blocks[0].text, false);
    if (
      !Array.isArray(value) ||
      !value.every(
        (id) => typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id),
      ) ||
      new Set(value).size !== value.length
    )
      throw new Error("Scripts must contain distinct module IDs.");
    scripts = value;
  }
  const auxiliary: Record<string, string> = {};
  const utilities = sections.find(
    (section) => section.name === "Utility Prompts",
  );
  if (utilities)
    for (const block of utilities.blocks) {
      const field = utilityFields[block.section];
      if (
        !field ||
        block.language !== "text" ||
        Object.hasOwn(auxiliary, field)
      )
        throw new Error(
          `Invalid or duplicate utility prompt: ${block.section}`,
        );
      if (Object.hasOwn(parameters, field))
        throw new Error(`Utility prompt is also in Settings: ${field}`);
      auxiliary[field] = block.text;
    }
  const prompts: Record<string, unknown>[] = [];
  const order: { identifier: string; enabled: boolean }[] = [];
  const ids = new Set<string>();
  for (const section of sections) {
    if (["Settings", "Scripts", "Utility Prompts"].includes(section.name))
      continue;
    const metadata = section.blocks.filter(
      (block) => block.section === "metadata",
    );
    const contents = section.blocks.filter(
      (block) => block.section === "content",
    );
    if (
      metadata.length !== 1 ||
      metadata[0].language !== "json" ||
      contents.length > 1 ||
      section.blocks.length !== metadata.length + contents.length
    )
      throw new Error(`Invalid prompt blocks: ${section.name}`);
    const data = json(metadata[0].text, false);
    if (
      !record(data) ||
      typeof data.identifier !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(data.identifier) ||
      typeof data.enabled !== "boolean" ||
      typeof data.marker !== "boolean" ||
      typeof data.system_prompt !== "boolean" ||
      Object.hasOwn(data, "name") ||
      Object.hasOwn(data, "content") ||
      (data.role !== undefined &&
        !["system", "user", "assistant"].includes(String(data.role)))
    )
      throw new Error(`Invalid prompt metadata: ${section.name}`);
    if (ids.has(data.identifier))
      throw new Error(`Duplicate prompt identifier: ${data.identifier}`);
    ids.add(data.identifier);
    if (
      data.marker
        ? contents.length !== 0
        : contents.length !== 1 || contents[0].language !== "text" || !data.role
    )
      throw new Error(`Invalid prompt content: ${section.name}`);
    const { enabled, ...native } = data;
    prompts.push({
      ...native,
      name: section.name,
      ...(contents.length ? { content: contents[0].text } : {}),
    });
    order.push({ identifier: data.identifier, enabled: enabled as boolean });
  }
  if (!prompts.length) throw new Error("No prompt entries found.");
  return {
    name,
    scripts,
    preset: {
      ...parameters,
      ...auxiliary,
      prompts,
      prompt_order: [{ character_id: 100001, order }],
    },
  };
}
