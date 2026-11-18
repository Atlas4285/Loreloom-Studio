# 预设模板

修改标题和占位内容，提示词按文档顺序排列。脚本在末尾 Scripts 中选择，不需要时使用空数组。

## Settings

```jsonc
{
  // 解锁上下文上限: 移除上下文滑块的最大值限制
  "max_context_unlocked": true,
  // 最大回复长度 (Token)
  "openai_max_tokens": 8192,
  // 上下文长度 (Token)
  "openai_max_context": 1000000,
  // 流式传输: 随着回复生成逐字显示结果。
  // 关闭此项时，回复将在完成后一次性显示。
  "stream_openai": true,
  // 温度
  "temperature": 1,
  // 频率惩罚
  "frequency_penalty": 0,
  // 存在惩罚
  "presence_penalty": 0,
  // Top P
  "top_p": 1,
  // 续写预填充: “续写”将以助手身份发送最后一条消息，而不是发送带有指令的系统消息。
  "continue_prefill": false,
  // 压缩系统消息: 将连续的系统消息合并为一条（不包括示例对话），可能会提高一些模型的连贯性。
  "squash_system_messages": false,
  // 启用函数调用: 允许使用功能工具. 可以被各种扩展利用来提供附加功能。 当提示词后处理没有选择工具时不支持。
  "function_calling": true,
  // 工具调用递归上限
  "tool_call_recurse_limit": 20,
  // 交错思维: 发送前面助手轮次的推理并附在工具调用请求中，以维持交错思维上下文。
  "tool_reasoning_mode": "disabled",
  // 发送内联媒体: 如果模型支持，就可以在提示词中发送媒体文件。
  "media_inlining": true,
  // 图片画质
  "inline_image_quality": "auto",
  // 请求思维链: 允许模型返回其思维过程。 此设置只影响思维链是否可见。
  "show_thoughts": true,
  // 推理强度: OpenAI式选项：低、中、高。极低等于低，极高等于高。选择自动，则不传入推理强度参数。
  "reasoning_effort": "high"
}
```

## Utility Prompts

### Impersonation prompt

```text
AI 帮答：填写代替用户生成输入时的指令，不使用时留空。
```

### World Info format template

```text
{0}
```

### Scenario format template

```text
{{scenario}}
```

### Personality format template

```text
{{personality}}
```

### Group Nudge prompt template

```text
群聊提示：填写引导 {{char}} 在群聊中回复的指令，不使用时留空。
```

### New Chat

```text
新聊天：填写聊天记录开头的分隔提示，不需要时留空。
```

### New Group Chat

```text
新群聊：填写群聊记录开头的分隔提示，不需要时留空。
```

### New Example Chat

```text
新对话示例：填写示例对话开头的分隔提示，不需要时留空。
```

### Continue nudge

```text
续写提示：填写点击续写时发送的指令，不使用时留空。
```

### Replace empty message

```text
空消息替代文本：填写用户输入为空时发送的内容，不需要时留空。
```

## 主提示词

metadata 使用 JSON：identifier 为唯一标识，enabled 控制默认启用，role 指定消息角色，marker 表示原生占位条目，system_prompt 标识酒馆内置提示词。

### metadata

```json
{
  "identifier": "main",
  "system_prompt": true,
  "role": "system",
  "marker": false,
  "enabled": true
}
```

### content

```text
主要提示词：填写模型的职责、回应方式与通用行为要求。具体人物和场景由角色卡、世界书与聊天内容提供。
```

## 辅助提示词

复制本条目并修改标题与 identifier，可增加独立开关的提示词。

### metadata

```json
{
  "identifier": "auxiliary",
  "system_prompt": false,
  "role": "system",
  "marker": false,
  "enabled": false
}
```

### content

```text
辅助提示词：填写独立的语言、文风、人称、篇幅或其他补充要求。
```

## 世界书（前置）

### metadata

```json
{
  "identifier": "worldInfoBefore",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 用户设定

### metadata

```json
{
  "identifier": "personaDescription",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 角色描述

### metadata

```json
{
  "identifier": "charDescription",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 角色性格

### metadata

```json
{
  "identifier": "charPersonality",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 场景设定

### metadata

```json
{
  "identifier": "scenario",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 世界书（后置）

### metadata

```json
{
  "identifier": "worldInfoAfter",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 对话示例

### metadata

```json
{
  "identifier": "dialogueExamples",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 聊天历史

### metadata

```json
{
  "identifier": "chatHistory",
  "system_prompt": true,
  "marker": true,
  "enabled": true
}
```

## 历史后指令

### metadata

```json
{
  "identifier": "jailbreak",
  "system_prompt": true,
  "role": "system",
  "marker": false,
  "enabled": true
}
```

### content

```text
历史后置指令：填写需要在聊天历史之后强调的回应要求，避免重复主提示词。
```

## Scripts

```json
[
  "studio-settings",
  "next-actions",
  "token-usage",
  "text-style"
]
```
