import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const supported = /\.(png|jpe?g|webp|avif)$/i;

function integer(
  value: string,
  name: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      quality: { type: "string", default: "82" },
      "icon-quality": { type: "string", default: "90" },
      "background-size": { type: "string", default: "1440" },
      "icon-size": { type: "string", default: "256" },
      effort: { type: "string", default: "6" },
      "keep-size": { type: "boolean", default: false },
      kind: { type: "string", default: "auto" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help || !positionals.length) {
    console.log(`Usage: npm run compress -- <file-or-directory> [...] [options]

Compress PNG, JPEG, WebP, or AVIF images. Directories are scanned recursively.
Output: dist/images/<input-name>.webp or dist/images/<directory-name>/
Source files remain unchanged. Directory structure is preserved.
Existing output images are overwritten; later inputs win on name collisions.

Options:
  --kind auto|icon|background  Auto detects icon- filenames (default: auto)
  --quality <1-100>           Background quality (default: 82)
  --icon-quality <1-100>      Icon quality (default: 90)
  --background-size <pixels> Maximum background width/height (default: 1440)
  --icon-size <pixels>       Maximum icon width/height (default: 256)
  --effort <0-6>             Encoding effort (default: 6)
  --keep-size                Preserve source dimensions
  --help                     Show this help`);
    if (!values.help) process.exitCode = 1;
    return;
  }
  if (!["auto", "icon", "background"].includes(values.kind!)) {
    throw new Error("kind must be auto, icon, or background.");
  }
  const settings = {
    quality: integer(values.quality!, "quality", 1, 100),
    iconQuality: integer(values["icon-quality"]!, "icon-quality", 1, 100),
    backgroundSize: integer(
      values["background-size"]!,
      "background-size",
      1,
      16383,
    ),
    iconSize: integer(values["icon-size"]!, "icon-size", 1, 16383),
    effort: integer(values.effort!, "effort", 0, 6),
    keepSize: values["keep-size"]!,
    kind: values.kind!,
  };
  const outputRoot = path.join(projectRoot, "dist/images");
  const sources: { input: string; output: string }[] = [];

  async function collect(input: string, output: string): Promise<void> {
    const relativeToOutput = path.relative(outputRoot, input);
    if (
      relativeToOutput === "" ||
      (!relativeToOutput.startsWith(`..${path.sep}`) &&
        relativeToOutput !== ".." &&
        !path.isAbsolute(relativeToOutput))
    ) {
      throw new Error("Inputs must not include dist/images output files.");
    }
    const info = await stat(input);
    if (info.isDirectory()) {
      const entries = await readdir(input, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.isSymbolicLink()) continue;
        if (
          entry.isDirectory() ||
          (entry.isFile() && supported.test(entry.name))
        ) {
          await collect(
            path.join(input, entry.name),
            path.join(output, entry.name),
          );
        }
      }
      return;
    }
    if (!info.isFile() || !supported.test(input)) {
      throw new Error(`Unsupported image: ${input}`);
    }
    const destination = path.join(
      path.dirname(output),
      `${path.parse(output).name}.webp`,
    );
    sources.push({ input, output: destination });
  }

  for (const argument of positionals) {
    const input = path.resolve(argument);
    await collect(input, path.basename(input));
  }
  if (!sources.length) throw new Error("No supported images found.");

  await mkdir(outputRoot, { recursive: true });
  const outputDirectory = outputRoot;
  let inputBytes = 0;
  let outputBytes = 0;
  let failures = 0;
  for (const source of sources) {
    try {
      const input = await readFile(source.input);
      const isIcon =
        settings.kind === "icon" ||
        (settings.kind === "auto" &&
          path.basename(source.input).startsWith("icon-"));
      let pipeline = sharp(input).rotate().toColourspace("srgb");
      if (!settings.keepSize) {
        const size = isIcon ? settings.iconSize : settings.backgroundSize;
        pipeline = pipeline.resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      const { data, info } = await pipeline
        .webp({
          quality: isIcon ? settings.iconQuality : settings.quality,
          alphaQuality: 100,
          effort: settings.effort,
          smartSubsample: true,
        })
        .toBuffer({ resolveWithObject: true });
      const destination = path.join(outputDirectory, source.output);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, data);
      console.log(
        JSON.stringify({
          file: source.output,
          width: info.width,
          height: info.height,
          bytes: data.length,
          mimeType: "image/webp",
          sha256: createHash("sha256").update(data).digest("hex"),
        }),
      );
      inputBytes += input.length;
      outputBytes += data.length;
      console.log(
        `${source.output}: ${(input.length / 1024).toFixed(1)} -> ${(data.length / 1024).toFixed(1)} KiB (${info.width}x${info.height})`,
      );
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${source.input}: ${message}`);
    }
  }
  console.log(`Output: ${outputDirectory}`);
  console.log(
    `Completed: ${sources.length - failures}; failed: ${failures}. ${(inputBytes / 1024 / 1024).toFixed(2)} -> ${(outputBytes / 1024 / 1024).toFixed(2)} MiB.`,
  );
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
