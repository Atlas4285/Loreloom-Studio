# Loreloom Studio

面向 SillyTavern 与酒馆助手的主题、脚本、角色卡和预设开发工作区。

**简体中文** | [English](README.en.md)

统一维护主题与图床资源，使用 Markdown 编写角色卡和预设，并按主题构建可直接导入的角色卡、预设或独立脚本。仓库提供通用开发工具与模板，个人创作可在独立仓库中维护。

## 目录

- [项目介绍](#项目介绍)
- [安装](#安装)
- [使用](#使用)
- [项目结构](#项目结构)
- [开发与贡献](#开发与贡献)
- [许可证](#许可证)
- [致谢](#致谢)

## 项目介绍

Loreloom Studio 将提示词编写、主题设计和脚本打包放在同一工作区中。项目使用 TypeScript、Vite 和 Sharp，当前提供：

- 四套共享语义颜色与图片槽位的主题，以及本地主题预览。
- 面向预设和角色卡的独立脚本，统一接入设置面板。
- 从 Markdown 源文件直接构建包含脚本的聊天补全预设和 JSON 角色卡。
- 单张图片、多文件或目录的 WebP 压缩。

| 主题 ID          | 名称                      |
| ---------------- | ------------------------- |
| `astral-prism`   | 星云琉璃 · Astral Prism   |
| `scarlet-allure` | 绯色悸动 · Scarlet Allure |
| `gilded-realms`  | 秘银王庭 · Gilded Realms  |
| `abyssal-tide`   | 旧日潮汐 · Abyssal Tide   |

可选脚本：

| 功能 ID           | 名称     | 归属   |
| ----------------- | -------- | ------ |
| `studio-settings` | 设置按钮 | 预设   |
| `next-actions`    | 后续选项 | 预设   |
| `token-usage`     | 用量统计 | 预设   |
| `text-style`      | 文本美化 | 预设   |
| `state-trace`     | 状态追踪 | 角色卡 |
| `random-integer`  | 随机整数 | 角色卡 |

## 安装

### 环境要求

- Node.js `>=22.12.0 <23`
- npm `>=10 <11`
- 使用构建产物时，需要 SillyTavern 和酒馆助手；状态追踪的模型自动更新还需要后端与模型支持函数调用。

### 安装依赖

获取项目后，在项目根目录执行：

```bash
npm ci
```

## 使用

### 预览主题

```bash
npm run dev:preview
```

打开 `http://127.0.0.1:5173`。预览默认中文，可切换主题与语言，查看色板、控件、图标和背景，并复制色值、图片链接及生成提示词。

构建静态预览：

```bash
npm run build:preview
```

输出位于 `dist/preview/`。

### 编写与打包预设

在 `presets/` 中维护一个 Markdown 文件，例如 [Template.md](presets/Template.md)。文件包含原生参数、辅助提示词、提示词条目的元数据与正文，以及末尾的脚本列表。

```bash
# Build all presets for all themes.
npm run build:presets

# Select a preset for all themes.
npm run build:presets --preset Template

# Select a preset and a theme.
npm run build:presets --preset Template --theme scarlet-allure
```

`--preset` 接受文件名或省略 `.md` 的名称。不指定预设或主题时，构建全部对应项；名称包含空格时需加引号。

成品位于 `dist/presets/<theme-id>/<预设名称>-<主题中文名称>.json`，可通过酒馆的聊天补全预设导入功能加载。构建直接编译并嵌入所需脚本，无须提前构建独立脚本，不输出中间预设 JSON。

`Scripts` 数组决定选择和顺序。预设模板依次嵌入设置按钮、后续选项、用量统计、文本美化；角色侧脚本由各角色卡的 `ScriptConfig` 或打包参数选择。

### 编写与打包角色卡

在 `characters/` 中维护每张角色卡的 Markdown，例如 [Template.md](characters/Template.md)。文件包含角色参数、描述、性格、场景、开场消息及其他提示词，可在 `character_book` 中编写随卡携带的世界书。

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

`--character` 接受文件名或省略 `.md` 的名称。不指定角色卡或主题时，构建全部对应项。默认按各卡 `ScriptConfig` 中的顺序嵌入脚本，未声明则不嵌入；`--scripts` 按顺序追加脚本并去重，`none` 禁用全部脚本。使用默认配置时可将模块的配置写为 `{}`。

`character_book` 使用一个整体配置块和每个词条各自的 JSON/JSONC 块，三级标题作为词条名称。构建时嵌入世界书并生成绑定名称，不使用时删除该部分。

成品位于 `dist/characters/<theme-id>/<角色卡名称>-<主题中文名称>.json`，可通过酒馆的角色导入功能加载。构建直接编译并嵌入所选脚本，无须提前构建独立脚本，不输出中间角色卡 JSON。

### 构建独立脚本

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

输出位于 `dist/scripts/<theme-id>/<presets|characters>/<feature-id>.json`。每个文件只包含一个功能和一个主题，可独立导入酒馆助手。

同一功能的不同主题沿用相同脚本 ID，作为替换版本使用，避免同时启用多个副本。角色侧状态追踪需在有效单角色上下文运行，字段编辑入口由预设侧设置按钮提供。新增功能可动态注册设置，无须在设置面板中维护模块名单。

脚本与预设构建支持直接传入上述 npm 参数，无须额外添加 `--`；也可使用 `--theme=scarlet-allure` 等形式。构建在内存中编译，不生成构建清单或项目持久缓存。

### 压缩与更新图片

新增或替换主题图片必须先压缩，再上传图床，不直接上传生成工具导出的原图。

```bash
npm run compress -- /path/to/image.png
npm run compress -- /path/to/theme-folder
npm run compress -- /path/to/a.png /path/to/b.png
npm run compress -- "/path/to/my images"
```

默认输出 WebP，保持比例和透明。文件名以 `icon-` 开头时按图标处理，最大宽高 256px、质量 90；其他图片按背景处理，最大宽高 1440px、质量 82。

输出位于 `dist/images/`，目录输入保留目录名称和内部结构，同名图片直接覆盖。上传后，将 URL 及终端报告的尺寸、字节数、MIME 和 SHA-256 写入对应主题的 `images.json`，并在预览中确认。脚本和预设仅引用图床链接，不嵌入图片二进制。

更多压缩选项：

```bash
npm run compress -- --help
```

## 项目结构

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

每个主题维护 `theme.json`、`palette.css`、`images.json`、`prompt.md`，共享 `themes/contract.json` 的颜色与资源契约。英文界面文案保存在源码，中文由 i18n 提供；主题和功能名称保存在各自元数据中。

## 开发与贡献

提交问题时附上酒馆、酒馆助手、Node.js 与 npm 版本，以及复现步骤和相关日志；修改代码时说明行为变化及实际验证范围。

```bash
npm run check
npm run format:check
npm run format
```

`check` 执行类型、主题契约及翻译检查；`format:check` 只检查格式，`format` 会修改文件。四个构建命令均先运行 `check`，实际宿主中的交互与兼容性仍需单独确认。

代码和代码注释使用英文，界面中文维护于 `locales/zh-CN.json`。预设正文和图片提示词属于创作数据，可以使用中文。新增或修改功能时保持中英文 README 同步。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方依赖及资源遵循各自的许可证。

## 致谢

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [酒馆助手](https://github.com/N0VI028/JS-Slash-Runner)
- [Standard Readme](https://github.com/RichardLitt/standard-readme) 与 [Best-README-Template](https://github.com/othneildrew/Best-README-Template)：本文档的组织方式参考。
