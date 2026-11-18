import { isLocalizedName, type LocalizedName } from "./names.ts";
import { isMessage, type Message } from "../i18n/message.ts";

export interface HostedThemeAsset {
  url: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/webp" | "image/png" | "image/jpeg" | "image/avif";
}

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: LocalizedName;
  description: Message;
  order: number;
  palette: "./palette.css";
  assets: "./images.json";
}

export interface ThemeContract {
  schemaVersion: number;
  groups: Array<{ id: string; label: Message; tokens: string[] }>;
  assetSlots: string[];
}

export interface Theme {
  manifest: ThemeManifest;
  palette: string;
  assets: Record<string, HostedThemeAsset>;
  prompts: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseThemeManifest(value: unknown): ThemeManifest {
  if (!isRecord(value)) throw new Error("Theme manifest must be an object.");
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    !isLocalizedName(value.name) ||
    !isMessage(value.description) ||
    !Number.isInteger(value.order) ||
    value.palette !== "./palette.css" ||
    value.assets !== "./images.json"
  ) {
    throw new Error("Theme manifest has invalid metadata.");
  }

  return value as unknown as ThemeManifest;
}

export function parseHostedAssets(
  value: unknown,
): Record<string, HostedThemeAsset> {
  if (!isRecord(value)) throw new Error("Image manifest must be an object.");
  for (const [slot, asset] of Object.entries(value)) {
    if (
      !isRecord(asset) ||
      typeof asset.url !== "string" ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !["width", "height", "bytes"].every(
        (key) => Number.isInteger(asset[key]) && Number(asset[key]) > 0,
      ) ||
      !["image/webp", "image/png", "image/jpeg", "image/avif"].includes(
        String(asset.mimeType),
      )
    ) {
      throw new Error(`Invalid hosted asset: ${slot}`);
    }
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error(`Hosted asset requires a public HTTPS URL: ${slot}`);
    }
  }
  return value as unknown as Record<string, HostedThemeAsset>;
}

export function validateTheme(
  theme: Theme,
  contract: ThemeContract,
  directoryId: string,
): void {
  if (theme.manifest.id !== directoryId) {
    throw new Error(`Theme directory and ID differ: ${directoryId}`);
  }
  const expected = contract.groups.flatMap((group) => group.tokens);
  const declared = Array.from(
    theme.palette.matchAll(/(--theme-[a-z-]+)\s*:/g),
    (match) => match[1],
  );
  if (
    new Set(declared).size !== declared.length ||
    expected.length !== declared.length ||
    expected.some((token) => !declared.includes(token))
  ) {
    throw new Error(`Theme token contract mismatch: ${directoryId}`);
  }
  const selector = `[data-loreloom-root][data-theme="${directoryId}"]`;
  if (!theme.palette.trimStart().startsWith(`${selector} {`)) {
    throw new Error(
      `Theme palette must use its scoped selector: ${directoryId}`,
    );
  }
  for (const match of theme.palette.matchAll(/var\((--theme-[a-z-]+)/g)) {
    if (!declared.includes(match[1])) {
      throw new Error(`Unknown token reference in ${directoryId}: ${match[1]}`);
    }
  }
  for (const slot of Object.keys(theme.assets)) {
    if (!contract.assetSlots.includes(slot)) {
      throw new Error(`Unknown theme asset slot: ${directoryId}/${slot}`);
    }
    if (!theme.prompts[slot]) {
      throw new Error(`Missing image prompt: ${directoryId}/${slot}`);
    }
  }
}
