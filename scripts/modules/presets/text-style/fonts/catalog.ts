import type { LocalizedName } from "../../../../../shared/contracts/names.ts";

export interface FontFile {
  id: string;
  url: string;
  sha256: string;
  bytes: number;
  format: "woff2" | "ttf";
  weight: string;
  style: "normal" | "italic";
}
export interface FontEntry {
  id: string;
  name: LocalizedName;
  revision: number;
  version: string;
  sourceUrl: string;
  releaseUrl: string;
  license: { id: string; url: string };
  files: FontFile[];
}
export interface FontCatalog {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  fonts: FontEntry[];
}
export const CATALOG_URL =
  "https://cloudreve.atlas4285.site/f/qQGsl/catalog.json";
export const FILE_LIMIT = 64 * 1024 * 1024;
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const reserved = new Set(["default", "constructor", "prototype"]);
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 256): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0;
function https(value: unknown): boolean {
  if (!text(value, 4096)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}
function unique<T>(values: T[], id: (value: T) => string): boolean {
  return new Set(values.map(id)).size === values.length;
}
export function parseCatalog(value: unknown): FontCatalog {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !revision(value.revision) ||
    !text(value.updatedAt) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.fonts) ||
    value.fonts.length > 64
  )
    throw new Error("Invalid font catalog.");
  for (const font of value.fonts) {
    if (
      !record(font) ||
      !text(font.id) ||
      !identifier.test(font.id) ||
      reserved.has(font.id) ||
      !record(font.name) ||
      !text(font.name.en, 128) ||
      !text(font.name["zh-CN"], 128) ||
      !revision(font.revision) ||
      !text(font.version, 64) ||
      !https(font.sourceUrl) ||
      !https(font.releaseUrl) ||
      !record(font.license) ||
      !text(font.license.id) ||
      !https(font.license.url) ||
      !Array.isArray(font.files) ||
      !font.files.length ||
      font.files.length > 8
    )
      throw new Error("Invalid font entry.");
    let total = 0;
    for (const file of font.files) {
      if (
        !record(file) ||
        !text(file.id) ||
        !identifier.test(file.id) ||
        !https(file.url) ||
        typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        Number(file.bytes) <= 0 ||
        Number(file.bytes) > FILE_LIMIT ||
        !["woff2", "ttf"].includes(String(file.format)) ||
        !["normal", "italic"].includes(String(file.style)) ||
        typeof file.weight !== "string" ||
        !/^(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(file.weight)
      )
        throw new Error("Invalid font file.");
      const weights = file.weight.split(" ").map(Number);
      if (weights.length === 2 && weights[0]! > weights[1]!)
        throw new Error("Invalid font weight range.");
      total += Number(file.bytes);
    }
    if (
      total > 128 * 1024 * 1024 ||
      !unique(font.files, (file) => String(file.id))
    )
      throw new Error("Invalid font file collection.");
  }
  if (!unique(value.fonts, (font) => String(font.id)))
    throw new Error("Duplicate font identifiers.");
  return structuredClone(value) as unknown as FontCatalog;
}
export function fontSignature(font: FontEntry): string {
  return JSON.stringify(
    font.files.map(({ id, sha256, bytes, format, weight, style }) => ({
      id,
      sha256,
      bytes,
      format,
      weight,
      style,
    })),
  );
}
export async function readBytes(
  response: Response,
  limit: number,
  progress?: (bytes: number) => void,
): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  if (!response.body) throw new Error("Response body is unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("File exceeds its expected size.");
      chunks.push(value);
      progress?.(total);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function verifyFont(
  file: FontFile,
  bytes: Uint8Array,
  crypto: Crypto,
): Promise<void> {
  if (bytes.byteLength !== file.bytes)
    throw new Error("Font size does not match the catalog.");
  const signature = Array.from(bytes.subarray(0, 4));
  const expected = file.format === "woff2" ? [119, 79, 70, 50] : [0, 1, 0, 0];
  if (!signature.every((byte, index) => byte === expected[index]))
    throw new Error("Unexpected font format.");
  if (!crypto.subtle)
    throw new Error("Font verification requires HTTPS or localhost.");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== file.sha256)
    throw new Error("Font checksum does not match the catalog.");
}
