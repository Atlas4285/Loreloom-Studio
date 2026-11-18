# 角色卡模板

修改标题和占位内容，未使用的文本字段留空。脚本通过 ScriptConfig 声明，或通过 --scripts 添加。

## Settings

```jsonc
{
  // 作者
  "creator": "",
  // 角色卡版本
  "character_version": "",
  // 分类标签
  "tags": [],
  "extensions": {
    // 群聊中的发言倾向，沿用导入卡的字段格式
    "talkativeness": "0.5",
    // 是否收藏
    "fav": false,
  },
}
```

## description

```text
角色描述：填写角色的身份、外貌、背景、经历、能力及其他稳定资料。若为讲述者卡，说明其负责的故事范围与叙述身份。
```

## personality

```text
角色设定摘要：填写角色的性格、动机、价值取向、表达习惯与行为特点。若为讲述者卡，说明其叙述职责及人物扮演范围。
```

## scenario

```text
情景：填写故事开始时的时间、地点、人物关系、当前处境及必要前提，区分初始条件与尚未发生的事件。
```

## first_mes

```text
开场白：填写展示给用户的默认开场消息，可以是场景开端、人物对白，或开始故事所需的信息填写引导。
```

## mes_example

```text
对话示例：
<START>
{{user}}: 用于展示互动方式的示例输入。
{{char}}: 用于展示称呼、语气、对白及回应方式的示例回复。
```

## creator_notes

```text
创作者的注释：填写面向使用者的角色卡介绍、使用方法和必要说明。
```

## system_prompt

填写本字段会导致提示词覆盖（用于聊天补全和格式指引模式）。将 {{original}} 插入到本框中，以包含系统设置中的相应默认提示词。

```text
主要提示词：填写确有需要的角色专属系统指令。通用人称、篇幅和写作要求由所用预设负责，本字段可留空。
```

## post_history_instructions

填写本字段会导致提示词覆盖（用于聊天补全和格式指引模式）。将 {{original}} 插入到本框中，以包含系统设置中的相应默认提示词。

```text
历史后置指令：填写需要放在聊天历史之后的角色专属提醒，聚焦本卡必须保持的职责、事实或互动要求；不需要时留空。
```

## depth_prompt

### metadata

```json
{
  "depth": 4,
  "role": "system"
}
```

### content

```text
角色备注：填写需要按指定深度插入聊天上下文的补充提示词；不需要时保留空正文。
```

## alternate_greetings

### 备用开场一

```text
其他开场白：填写与默认开场不同的可选开场。每个备用开场使用独立的三级标题和 text 代码块，按文档顺序排列。
```

## character_book

```jsonc
{
  // 世界书名称，同时用于生成角色卡的绑定名称
  "name": "角色卡模板·世界书",
  // 世界书简介
  "description": "填写本世界书的内容范围与用途。",
  // 世界书级扩展数据
  "extensions": {},
  // 以下书级可选字段当前不会被酒馆内嵌导入器应用，实际使用酒馆全局设置；按需取消注释。
  // 扫描深度：扫描最近多少条聊天消息；可在词条中单独覆盖
  // "scan_depth": 2,
  // 世界书 token 预算
  // "token_budget": 2048,
  // 是否递归扫描已激活词条的内容
  // "recursive_scanning": true,
}
```

### 词条名称

```jsonc
{
  // 三级标题生成前端的“条目标题/备忘录”；复制本块并修改标题即可新增词条。
  // 词条编号，同一本书内唯一；可省略，由构建器自动分配
  "id": 0,
  // 启用状态：true=启用，false=禁用
  "enabled": true,
  // 主要关键字：每项为一个关键词或 /正则表达式/flags
  "keys": ["关键词", "关键词别称"],
  // 可选过滤器：为空时忽略，非空时配合 selectiveLogic 使用
  "secondary_keys": [],
  // 触发策略：true=永久；false 且 vectorized=false 时为关键词
  "constant": false,
  // 是否启用次要关键词过滤
  "selective": true,
  // 前端“顺序”，不是词条在 Markdown 中的展示序号
  "insertion_order": 100,
  // before_char=角色定义前，after_char=角色定义后；酒馆优先使用 extensions.position
  "position": "before_char",
  // 正则支持标记；酒馆按关键词自身的 /.../flags 格式识别正则
  "use_regex": true,
  // 实际发送给模型的内容；换行用 \n，双引号用 \"
  "content": "填写词条正文，包括相关背景、规则或人物资料。\n可继续填写下一段内容。",
  "extensions": {
    // 0=角色定义前，1=角色定义后，2=作者注释前，3=作者注释后，4=插入深度 @D，5=示例消息前，6=示例消息后，7=锚点
    "position": 0,
    // 深度，仅 position=4 时生效
    "depth": 4,
    // 插入深度的消息角色：0=系统，1=用户，2=AI；仅 position=4 时生效
    "role": 0,
    // 锚点名称，仅 position=7 时使用；通过 {{outlet::锚点名称}} 引用
    "outlet_name": "",
    // 可选过滤器逻辑：0=与任意，1=非所有，2=非任何，3=与所有
    "selectiveLogic": 0,
    // 向量化触发策略，需酒馆对应的向量存储功能支持
    "vectorized": false,
    // 是否启用触发概率
    "useProbability": true,
    // 前端“触发 %”，范围 0～100；永久词条也受概率等条件约束
    "probability": 100,
    // 扫描深度：null=使用全局设置，整数=此词条单独使用的扫描消息数
    "scan_depth": null,
    // 区分大小写：null=使用全局设置，true=是，false=否
    "case_sensitive": null,
    // 完整单词：null=使用全局设置，true=是，false=否
    "match_whole_words": null,
    // 不可递归：不被其他词条的内容递归激活
    "exclude_recursion": false,
    // 防止进一步递归：本词条的内容不继续激活其他词条
    "prevent_recursion": false,
    // 延迟到递归：false/0=关闭，true/1=开启，正整数可指定递归等级
    "delay_until_recursion": 0,
    // 包含组：同组词条参与组内筛选，留空表示不分组
    "group": "",
    // 优先包含：组内优先选择本词条，多个优先词条按插入顺序筛选
    "group_override": false,
    // 组权重：组内随机选择的相对权重
    "group_weight": 100,
    // 组评分：null=使用全局设置，true=是，false=否
    "use_group_scoring": null,
    // 黏性：触发后保持激活的消息数，0=关闭
    "sticky": 0,
    // 冷却：激活结束后不能再次触发的消息数，0=关闭
    "cooldown": 0,
    // 延迟：聊天至少存在多少条消息后才能激活，0=关闭
    "delay": 0,
    // 无视回复限额：其他检查通过时，无视世界书 token 预算
    "ignore_budget": false,
    // 额外匹配来源：用户描述
    "match_persona_description": false,
    // 额外匹配来源：角色描述
    "match_character_description": false,
    // 额外匹配来源：角色性格
    "match_character_personality": false,
    // 额外匹配来源：角色备注
    "match_character_depth_prompt": false,
    // 额外匹配来源：情景
    "match_scenario": false,
    // 额外匹配来源：创作者的注释
    "match_creator_notes": false,
    // 自动化 ID，用于与快速回复等自动化功能联动
    "automation_id": "",
    // 筛选生成触发器：[]=不限制；normal=正常，continue=续写，impersonate=AI 帮答，swipe=备选回复，regenerate=重新生成，quiet=静默
    "triggers": [],
    // 编辑器展示顺序，由构建器按词条文档顺序生成，无需手写
    // "display_index": 0,
  },
  // 以下可选字段当前不会被酒馆内嵌导入器读取，供支持它们的前端使用；按需取消注释。
  // 规范中的名称；酒馆界面标题使用三级标题生成的 comment
  // "name": "词条名称",
  // 规范中的预算不足时的保留优先级
  // "priority": 10,
  // 规范中的大小写设置；酒馆使用 extensions.case_sensitive
  // "case_sensitive": false,
  // 前端“绑定到角色或标签”；当前内嵌导入器不会恢复该筛选
  // "character_filter": {
  // false=仅匹配列表内角色/标签，true=排除
  //   "isExclude": false,
  // 角色文件名，不含扩展名
  //   "names": [],
  // 酒馆本地标签 ID，不是标签显示名称
  //   "tags": [],
  // },
}
```

## ScriptConfig

### state-trace

```jsonc
{
  "enabled": true,
  "fields": [
    {
      "name": "day",
      "label": "天数",
      "description": "当前故事天数。只在剧情实际跨入下一天时更新。",
      "type": "number",
      "defaultValue": 1,
      "min": 1,
    },
    {
      "name": "period",
      "label": "时段",
      "description": "当前场景的时段，与正文中的时间保持一致。",
      "type": "tag",
      "defaultValue": "下午",
      "options": ["清晨", "上午", "中午", "下午", "傍晚", "夜晚", "深夜"],
    },
    {
      "name": "location",
      "label": "地点",
      "description": "主角当前所在地点。移动完成后更新。",
      "type": "text",
      "defaultValue": "填写与默认开场一致的初始地点",
      "maxLength": 80,
    },
  ],
}
```
