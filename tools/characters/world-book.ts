import ts from "typescript";
import type { Section } from "../markdown.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const triggers = new Set([
  "normal",
  "continue",
  "impersonate",
  "swipe",
  "regenerate",
  "quiet",
]);

function object(block: Section["blocks"][number]) {
  if (!["json", "jsonc"].includes(block.language))
    throw new Error("Expected one JSON or JSONC object per block.");
  const parsed =
    block.language === "jsonc"
      ? ts.parseConfigFileTextToJson("world-book.jsonc", block.text)
      : { config: JSON.parse(block.text) as unknown };
  if (parsed.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
    );
  if (!record(parsed.config))
    throw new Error("Configuration must be an object.");
  return parsed.config;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}.`);
}
function check(
  value: Record<string, unknown>,
  key: string,
  valid: (v: unknown) => boolean,
) {
  if (Object.hasOwn(value, key) && !valid(value[key]))
    throw new Error(`Invalid field: ${key}.`);
}
function extensions(value: Record<string, unknown>) {
  for (const key of [
    "exclude_recursion",
    "prevent_recursion",
    "useProbability",
    "group_override",
    "vectorized",
    "ignore_budget",
    "match_persona_description",
    "match_character_description",
    "match_character_personality",
    "match_character_depth_prompt",
    "match_scenario",
    "match_creator_notes",
  ])
    check(value, key, (v) => typeof v === "boolean");
  for (const key of [
    "case_sensitive",
    "match_whole_words",
    "use_group_scoring",
  ])
    check(value, key, (v) => v === null || typeof v === "boolean");
  for (const key of ["outlet_name", "group", "automation_id"])
    check(value, key, (v) => typeof v === "string");
  for (const key of ["scan_depth", "sticky", "cooldown", "delay"])
    check(value, key, (v) => v === null || integer(v));
  check(value, "depth", (v) => integer(v));
  check(value, "position", (v) => integer(v, 0, 7));
  check(value, "role", (v) => v === null || integer(v, 0, 2));
  check(value, "selectiveLogic", (v) => integer(v, 0, 3));
  check(
    value,
    "probability",
    (v) =>
      v === null ||
      (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100),
  );
  check(
    value,
    "group_weight",
    (v) =>
      v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0),
  );
  check(
    value,
    "delay_until_recursion",
    (v) => typeof v === "boolean" || integer(v),
  );
  check(
    value,
    "triggers",
    (v) => strings(v) && (v as string[]).every((t) => triggers.has(t)),
  );
  if (Object.hasOwn(value, "display_index"))
    throw new Error("extensions.display_index is generated from entry order.");
}

export function parseWorldBook(section: Section) {
  try {
    const settings = section.blocks.filter((block) => !block.section);
    if (settings.length !== 1 || section.blocks[0] !== settings[0])
      throw new Error(
        "Begin with one book-level configuration block before entry headings.",
      );
    const book = object(settings[0]);
    keys(book, [
      "name",
      "description",
      "scan_depth",
      "token_budget",
      "recursive_scanning",
      "extensions",
    ]);
    if (typeof book.name !== "string" || !book.name.trim())
      throw new Error("World book name must be a non-empty string.");
    check(book, "description", (v) => typeof v === "string");
    for (const key of ["scan_depth", "token_budget"])
      check(book, key, (v) => integer(v));
    check(book, "recursive_scanning", (v) => typeof v === "boolean");
    check(book, "extensions", record);
    const titles = new Set<string>();
    const used = new Set<number>();
    const entries = section.blocks
      .filter((block) => block.section)
      .map((block) => {
        try {
          if (titles.has(block.section))
            throw new Error(
              "Each distinct entry heading requires exactly one configuration block.",
            );
          titles.add(block.section);
          const entry = object(block);
          keys(entry, [
            "id",
            "enabled",
            "keys",
            "secondary_keys",
            "constant",
            "selective",
            "insertion_order",
            "position",
            "use_regex",
            "content",
            "extensions",
            "name",
            "priority",
            "case_sensitive",
            "character_filter",
          ]);
          check(entry, "id", (v) => integer(v));
          if (typeof entry.id === "number") {
            if (used.has(entry.id))
              throw new Error(`Duplicate entry ID: ${entry.id}.`);
            used.add(entry.id);
          }
          for (const key of [
            "enabled",
            "constant",
            "selective",
            "use_regex",
            "case_sensitive",
          ])
            check(entry, key, (v) => typeof v === "boolean");
          for (const key of ["keys", "secondary_keys"])
            check(
              entry,
              key,
              (v) => strings(v) && (v as string[]).every((s) => !!s.trim()),
            );
          check(entry, "insertion_order", (v) => integer(v));
          check(
            entry,
            "priority",
            (v) => typeof v === "number" && Number.isFinite(v),
          );
          check(entry, "name", (v) => typeof v === "string");
          check(
            entry,
            "position",
            (v) => v === "before_char" || v === "after_char",
          );
          check(entry, "extensions", record);
          if (typeof entry.content !== "string" || !entry.content.trim())
            throw new Error("content must be a non-empty string.");
          check(entry, "character_filter", record);
          if (record(entry.character_filter)) {
            keys(entry.character_filter, ["isExclude", "names", "tags"]);
            check(
              entry.character_filter,
              "isExclude",
              (v) => typeof v === "boolean",
            );
            for (const key of ["names", "tags"])
              check(entry.character_filter, key, strings);
          }
          const extra = {
            ...(entry.extensions as Record<string, unknown> | undefined),
          };
          extensions(extra);
          const position = Number(
            extra.position ?? (entry.position === "after_char" ? 1 : 0),
          );
          const fallback = position === 0 ? "before_char" : "after_char";
          if (
            Number(position) <= 1 &&
            entry.position !== undefined &&
            entry.position !== fallback
          )
            throw new Error("position conflicts with extensions.position.");
          if (
            position === 7 &&
            (typeof extra.outlet_name !== "string" || !extra.outlet_name.trim())
          )
            throw new Error(
              "Anchor insertion requires extensions.outlet_name.",
            );
          if (
            entry.enabled !== false &&
            entry.constant !== true &&
            extra.vectorized !== true &&
            !(entry.keys as unknown[] | undefined)?.length
          )
            throw new Error(
              "Enabled keyword entries require at least one primary key.",
            );
          return {
            enabled: true,
            keys: [],
            secondary_keys: [],
            constant: false,
            selective: true,
            insertion_order: 100,
            use_regex: true,
            ...entry,
            id: entry.id as number | undefined,
            comment: block.section,
            position: fallback,
            extensions: { ...extra, position, display_index: titles.size - 1 },
          };
        } catch (error) {
          throw new Error(
            `${block.section}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    if (!entries.length)
      throw new Error("World book requires at least one entry.");
    let nextId = 0;
    const complete = entries.map((entry) => {
      if (entry.id !== undefined) return entry;
      while (used.has(nextId)) nextId++;
      const id = nextId++;
      used.add(id);
      return { ...entry, id };
    });
    return {
      ...book,
      name: book.name,
      extensions: book.extensions ?? {},
      entries: complete,
    };
  } catch (error) {
    throw new Error(
      `character_book: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
