import { readScriptCatalog } from "./scripts/catalog.ts";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isMessage, type Message } from "../shared/i18n/message.ts";
import { parseImagePrompts } from "../shared/theme/prompts.ts";
import {
  parseThemeManifest,
  parseHostedAssets,
  validateTheme,
  type ThemeContract,
} from "../shared/contracts/theme.ts";

const projectRoot = new URL("../", import.meta.url);
const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, projectRoot), "utf8"));
const contract = (await readJson("themes/contract.json")) as ThemeContract;
const translations = await readJson("locales/zh-CN.json");
const messages = new Map<string, string>();

function register(source: Message): void {
  if (!isMessage(source) || /\p{Script=Han}/u.test(source.text)) {
    throw new Error("Source messages must have a stable key and English text.");
  }
  const existing = messages.get(source.key);
  if (existing !== undefined && existing !== source.text) {
    throw new Error(`Conflicting English defaults: ${source.key}`);
  }
  messages.set(source.key, source.text);
}

for (const group of contract.groups) register(group.label);
const requiredTokens = contract.groups.flatMap((group) => group.tokens);
if (new Set(requiredTokens).size !== requiredTokens.length) {
  throw new Error("Theme contract contains duplicate tokens.");
}

const directories = await readdir(new URL("themes/", projectRoot), {
  withFileTypes: true,
});
const orders = new Set<number>();
let count = 0;
for (const entry of directories) {
  if (!entry.isDirectory()) continue;
  const manifest = parseThemeManifest(
    await readJson(`themes/${entry.name}/theme.json`),
  );
  const palette = await readFile(
    new URL(`themes/${entry.name}/palette.css`, projectRoot),
    "utf8",
  );
  const assets = parseHostedAssets(
    await readJson(`themes/${entry.name}/images.json`),
  );
  const prompts = parseImagePrompts(
    await readFile(
      new URL(`themes/${entry.name}/prompt.md`, projectRoot),
      "utf8",
    ),
  );
  validateTheme({ manifest, palette, assets, prompts }, contract, entry.name);
  if (orders.has(manifest.order)) {
    throw new Error(`Duplicate theme order: ${manifest.order}`);
  }
  orders.add(manifest.order);
  register(manifest.description);
  count++;
}
if (!count) throw new Error("No themes were found.");

async function checkSource(directory: URL): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) {
      await checkSource(path);
    } else if (/\.(ts|js|css|html)$/.test(entry.name)) {
      const content = await readFile(path, "utf8");
      if (/\p{Script=Han}/u.test(content)) {
        throw new Error(
          `Source must use English; move Chinese UI text to locales: ${fileURLToPath(path)}`,
        );
      }
      if (!/\.(ts|js)$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        fileURLToPath(path),
        content,
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "message"
        ) {
          const [key, text] = node.arguments;
          if (
            node.arguments.length !== 2 ||
            !key ||
            !text ||
            !ts.isStringLiteral(key) ||
            !ts.isStringLiteral(text)
          ) {
            throw new Error(
              `message() requires literal key and English text: ${fileURLToPath(path)}`,
            );
          }
          register({ key: key.text, text: text.text });
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
for (const directory of ["preview/", "shared/", "tools/", "scripts/"]) {
  await checkSource(new URL(directory, projectRoot));
}

if (
  !translations ||
  typeof translations !== "object" ||
  Array.isArray(translations)
) {
  throw new Error("Chinese translations must be an object.");
}
const dictionary = translations as Record<string, unknown>;
const parameters = (text: string): string =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
for (const [key, text] of Object.entries(dictionary)) {
  const fallback = messages.get(key);
  if (fallback === undefined) throw new Error(`Unused translation: ${key}`);
  if (typeof text !== "string" || !text.trim())
    throw new Error(`Invalid Chinese translation: ${key}`);
  if (parameters(text) !== parameters(fallback))
    throw new Error(`Translation parameters differ: ${key}`);
}
for (const key of messages.keys()) {
  if (!Object.hasOwn(dictionary, key))
    throw new Error(`Missing Chinese translation: ${key}`);
}
const scripts = await readScriptCatalog();
console.log(
  `Validated ${scripts.profiles.length} script profiles and ${scripts.modules.length} module manifests.`,
);
console.log(
  `Validated ${count} themes, ${requiredTokens.length} tokens per theme, and ${messages.size} source messages with Chinese translations.`,
);
