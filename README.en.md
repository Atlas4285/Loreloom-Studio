# Loreloom Studio

A workspace for developing themes, scripts, character cards, and presets for SillyTavern and Tavern Helper.

[简体中文](README.md) | **English**

Maintain shared themes and hosted assets, write character cards and presets in Markdown, and build cards, presets, or independent scripts for each theme, ready to import into SillyTavern. This repository provides general development tools and templates; personal content can be maintained in a separate repository.

## Table of Contents

- [About](#about)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Development and Contributing](#development-and-contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## About

Loreloom Studio brings prompt authoring, theme design, and script packaging into one workspace. Built with TypeScript, Vite, and Sharp, it currently provides:

- Four themes with shared semantic colors and asset slots, plus a local theme preview.
- Independent scripts for presets and character cards, with shared settings integration.
- Direct builds of chat completion presets and JSON character cards with embedded scripts from Markdown sources.
- WebP compression for individual images, multiple inputs, or entire directories.

| Theme ID         | Name                      |
| ---------------- | ------------------------- |
| `astral-prism`   | Astral Prism · 星云琉璃   |
| `scarlet-allure` | Scarlet Allure · 绯色悸动 |
| `gilded-realms`  | Gilded Realms · 秘银王庭  |
| `abyssal-tide`   | Abyssal Tide · 旧日潮汐   |

Available scripts:

| Feature ID        | Name            | Target         |
| ----------------- | --------------- | -------------- |
| `studio-settings` | Studio Settings | Preset         |
| `next-actions`    | Next Actions    | Preset         |
| `token-usage`     | Token Usage     | Preset         |
| `text-style`      | Text Style      | Preset         |
| `state-trace`     | State Trace     | Character card |
| `random-integer`  | Random Integers | Character card |

## Installation

### Requirements

- Node.js `>=22.12.0 <23`
- npm `>=10 <11`
- SillyTavern and Tavern Helper to use the generated artifacts. Automatic State Trace updates also require a backend and model that support function calling.

### Install Dependencies

After obtaining the project, run the following command from its root directory:

```bash
npm ci
```

## Usage

### Preview Themes

```bash
npm run dev:preview
```

Open `http://127.0.0.1:5173`. The preview defaults to Simplified Chinese and supports theme and language selection, palettes, sample controls, icons, and backgrounds. Color values, asset URLs, and image prompts can be copied from the preview.

Build the static preview:

```bash
npm run build:preview
```

Output is written to `dist/preview/`.

### Author and Package Presets

Maintain one Markdown file per preset in `presets/`, such as [Template.md](presets/Template.md). Each file contains native settings, utility prompts, prompt metadata and content, and a script list at the end.

```bash
# Build all presets for all themes.
npm run build:presets

# Select a preset for all themes.
npm run build:presets --preset Template

# Select a preset and a theme.
npm run build:presets --preset Template --theme scarlet-allure
```

`--preset` accepts a filename with or without `.md`. Omitting a preset or theme selects all available entries in that category. Quote names containing spaces.

Output is written to `dist/presets/<theme-id>/<preset-name>-<Chinese-theme-name>.json`. Import the result through SillyTavern's chat completion preset controls. The build compiles and embeds the required scripts directly; no separate script build or intermediate preset JSON is needed.

The `Scripts` array determines which features are included and their order. The preset template embeds Studio Settings, Next Actions, Token Usage, and Text Style in that order. Character-side scripts are selected through each card's `ScriptConfig` or build options.

### Author and Package Character Cards

Maintain one Markdown file per card in `characters/`, such as [Template.md](characters/Template.md). Each file contains character settings, description, personality, scenario, greetings, and other prompts, with an optional embedded lorebook authored in `character_book`.

```bash
# Build all cards for all themes.
npm run build:characters

# Select a card and a theme.
npm run build:characters --character Template --theme scarlet-allure

# Add scripts to those declared in ScriptConfig.
npm run build:characters --character Template --scripts random-integer

# Build without embedded scripts.
npm run build:characters --character Template --scripts none
```

`--character` accepts a filename with or without `.md`. Omitting a card or theme selects all available entries in that category. By default, scripts are embedded in each card's `ScriptConfig` order; no declarations means no scripts. `--scripts` appends scripts in order without duplicates; `none` disables all scripts. Use `{}` for a module's default configuration.

`character_book` contains one book-level configuration block and a separate JSON/JSONC block for each entry. Third-level headings supply entry titles. The build embeds the lorebook and generates its binding name; remove this section when no lorebook is needed.

Output is written to `dist/characters/<theme-id>/<card-name>-<Chinese-theme-name>.json`. Import the result through SillyTavern's character import controls. The build compiles and embeds the selected scripts directly; no separate script build or intermediate character JSON is needed.

### Build Independent Scripts

```bash
# Build all themes and features.
npm run build:scripts

# Select one theme.
npm run build:scripts --theme scarlet-allure

# Select one feature.
npm run build:scripts --feature state-trace

# Select both.
npm run build:scripts --theme scarlet-allure --feature token-usage
```

Output is written to `dist/scripts/<theme-id>/<presets|characters>/<feature-id>.json`. Each file contains one feature and one theme and can be imported independently into Tavern Helper.

Theme variants of the same feature share a stable script ID and are intended as replacements; avoid enabling multiple copies simultaneously. State Trace requires an active single-character context, and its field editor is accessed through the preset-side Studio Settings feature. New features register settings dynamically without a module list in the settings panel.

Script and preset build options work directly with npm as shown, without an extra `--` separator. Explicit assignments such as `--theme=scarlet-allure` are also supported. Compilation runs in memory and produces no build manifest or persistent project cache.

### Compress and Update Images

Compress new or replacement theme images before uploading them to your image host. Do not upload unprocessed image-generation output.

```bash
npm run compress -- /path/to/image.png
npm run compress -- /path/to/theme-folder
npm run compress -- /path/to/a.png /path/to/b.png
npm run compress -- "/path/to/my images"
```

Images are converted to WebP with their aspect ratio and transparency preserved. Files beginning with `icon-` are treated as icons, with a maximum width and height of 256px and quality 90. Other images are treated as backgrounds, with a maximum width and height of 1440px and quality 82.

Output is written to `dist/images/`. Directory inputs preserve their directory name and internal structure; existing images at the same path are overwritten. After uploading, update the theme's `images.json` with the URL and the dimensions, byte count, MIME type, and SHA-256 reported in the terminal, then inspect the preview. Scripts and presets reference hosted URLs instead of embedding image binaries.

For additional compression options:

```bash
npm run compress -- --help
```

## Project Structure

```text
themes/                     # Theme metadata, palettes, hosted images and prompts
preview/                    # Local theme preview
presets/                    # Preset Markdown sources
characters/                 # Character card Markdown sources with optional embedded lorebooks
fonts/                      # Hosted font catalog
scripts/
  modules/presets/           # Preset features
  modules/characters/        # Character features
  profiles/                  # Feature ownership
  runtime/                   # Shared script runtime
shared/                     # Contracts, host adapter, i18n and image loading
locales/zh-CN.json          # Simplified Chinese UI translations
tools/                      # Checks, compression and build tools
dist/                       # Generated output, excluded from Git
```

Each theme maintains `theme.json`, `palette.css`, `images.json`, and `prompt.md`, following the shared color and asset contract in `themes/contract.json`. English UI text lives in the source, with Chinese supplied through i18n. Theme and feature names are maintained in their own metadata.

## Development and Contributing

When reporting a problem, include the SillyTavern, Tavern Helper, Node.js, and npm versions, reproduction steps, and relevant logs. Code changes should describe the behavior change and what was actually verified.

```bash
npm run check
npm run format:check
npm run format
```

`check` validates types, theme contracts, and translations. `format:check` checks formatting without edits; `format` rewrites files. All four build commands run `check` first. Interaction and compatibility within the host still require separate verification.

Use English in code and code comments, and maintain Chinese UI translations in `locales/zh-CN.json`. Preset content and image prompts are authored data and may use Chinese. Keep both README versions aligned when adding or changing features.

## License

This project is licensed under the [MIT License](LICENSE). Third-party dependencies and assets remain subject to their respective licenses.

## Acknowledgments

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [Tavern Helper](https://github.com/N0VI028/JS-Slash-Runner)
- [Standard Readme](https://github.com/RichardLitt/standard-readme) and [Best-README-Template](https://github.com/othneildrew/Best-README-Template) for documentation structure references.
