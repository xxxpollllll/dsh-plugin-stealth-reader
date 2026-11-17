# 设置生效矩阵 — stealth-reader

本文件把每个设置项的真实行为写成可核对的一行。**"实测"一栏的值来自真实 Chrome 157 的
`getComputedStyle`，不是从 CSS 推的**（脚本见 `verify/harness.mjs`、`verify/fontprobe.mjs`，
原始输出见 `verify/measured.json`）。凡标注"推断"的，是尚未实测的部分。

## 怎么读这张表

- **应在**：按槽位契约，这一项**应该**作用在哪个表面。依据见 §2 的契约原文。
- **实测**：真实浏览器测量的结果。`—` 表示该项不作用于该表面。
- **分级**：`实测` / `契约` / `推断`。没有前三者支撑的结论不会写进这张表。

## 1. 主表

| 设置键 | 控件 | 默认 | 宿主夹取 | UI 夹取 | 应在 | 实测（右侧栏） | 实测（卡片） | 分级 |
|---|---|---|---|---|---|---|---|---|
| `skin` | 4 选 1 | `log` | 无枚举校验 | 固定 4 值 | 仅伪装形态 | 生效（配色+字体+行距全改） | 只改**措辞**，不改外观 | 实测+契约 |
| `fontSize` | 滑杆 | 15 | **无** | 11–26 | 右侧栏 | `log/terminal/diff` 实测 **want 15 → got 14px**；`plain` 正确 | **完全无效**（实测 13px） | 实测 |
| `lineHeight` | 滑杆 | 1.9 | **无** | 1.3–2.6 | 右侧栏 | `log` want 28.5 → got **24.5px**；`terminal/diff` want 28.5 → got **23.8px**；`plain` 正确 | **完全无效**（实测 21.45px） | 实测 |
| `font` | 3 选 1 | `sans` | **无** | 3 值 | 右侧栏 | **四个皮肤全部覆盖为 monospace**（`plain` 被覆盖为 PingFang） | 无效 | 实测 |
| `width` | 滑杆 | 430 | **无** | 320–720 | 仅伪装形态 | `.sr-panel`=430px；**`.sr-panel-sidebar` 实测 1280px**（被 `width:100%` 覆盖） | — | 实测 |
| `scrollMode` | 2 选 1 | `chapter` | 无校验 | 2 值 | 右侧栏 | 生效 | **无效** | 实测 |
| `placement` | 2 选 1 | `strip` | ✓ 枚举 | 2 值 | 两个 | 生效 | 生效 | 契约 |
| `stripLines` | 滑杆 | 3 | **无** | 1–8 | 仅卡片 | — | 生效 | 实测 |
| `stripStep` | **无控件** | 220 | 无 | — | — | **死代码**：全仓库仅 `lib/index.js:219`，无控件、无读取、无渲染 | — | 实测 |
| `libraryDirs` | 列表 | `[]` | ✓ 上限 20 | — | 书库 | 生效 | 生效 | 契约 |
| `libraryShape` | 开关 | `list` | ✓ 枚举 | 2 值 | 书库 | 生效 | 生效 | 契约 |
| `cardHead` | 3 选 1 | `book` | ✓ 枚举 | 3 值 | 仅卡片 | — | 生效 | 实测 |
| `barLabel` | 3 选 1 | `head` | ✓ 枚举 | 3 值 | 卡片折叠条 | — | 生效 | 实测 |
| `barCoverText` | 预设+输入 | `'Reading notes'` | ✓ 截断 40 | `maxLength` 40 | 卡片折叠条 | — | 生效，但**中文下四个预设全不高亮** | 实测 |
| `barProgress` | 4 选 1 | `percent` | ✓ 枚举 | 4 值 | 卡片折叠条 | — | 生效 | 实测 |
| `cardFoldDelay` | 滑杆 | 260 | **80–2000** | **80–800** | 卡片 | — | 生效 | 实测（**夹取不一致**） |
| `cardFoldMode` | 3 选 1 | `manual` | ✓ 枚举 | 3 值 | 卡片 | — | 生效 | 实测 |
| `cardAlign` | 3 选 1 | `right` | ✓ 枚举 | 3 值 | 卡片圆标 | — | 生效（折叠条形态下隐藏） | 实测 |
| `cardOffset` | 滑杆 | 0 | −200–200 | −200–200 | 卡片圆标 | — | 生效，但**折叠条/不可折叠时仍显示** | 实测 |
| `cardFoldable` | 2 选 1 | `true` | ✓ 布尔 | 2 值 | 卡片 | — | 生效 | 实测 |
| `cardFoldedShape` | 2 选 1 | `mark` | ✓ 枚举 | 2 值 | 卡片 | — | 生效 | 实测 |

## 2. 契约依据（一手原文）

**槽位声明** — `@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts:301-310`：

```
/**
 * Full-width entries above the composer card; fixed overlays must portal to the document body
 * because the docked composer contains them.
 */
'conversation.input.dock': { kind: 'list'; scope: 'session'; owner: InputZone }
```

**为什么必须 portal** — `dsh-client-ui-layout/src/client/AppFrame.module.css` 与
`dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css:528-536` 原文：

```
/* A direct compositing reason: ... A transform hint keeps descendant backdrop blur
   sampling the transcript, but makes the seat the containing block for
   fixed-position descendants, so every fixed overlay inside the composer
   (tooltips, menus, panels) must portal to the document body. */
will-change: transform;
```

同文件 `:591-594` 还有第二条同源约束：

```
/* Hero phase: ... Flex, NOT absolute+transform: a transform would make this box the
   containing block for position:fixed descendants (pickers/modals), shrinking them. */
```

**实测验证了这条约束真实存在**（`verify/popup.mjs`，Chrome 157）：

| 祖先 | popup 视口坐标 |
|---|---|
| 无 transform | `{top:20, left:20}` |
| `transform:translateY(1px)` | `{top:29, left:28}` ← **偏移了** |
| `will-change:transform` | `{top:28, left:28}` ← **同样偏移** |

**插件当前的处置是对的**：`StripPopup` 渲染在 `shell.overlay`（`lib/client.js:5627`），
不是 dock 内，因此避开了 `will-change` 造成的包含块。
`.overlayLayer` 是 `position:absolute; inset:0`，其祖先 `.frame` 只有 `overflow:hidden`、
无 transform，所以 `fixed` 相对视口正常。
→ **本条不是缺陷，是已正确处理的项。** 记录在此以防后续被"优化"成放进 dock。

**侧栏表面** — `DESIGN.md` D2 节已记录：

> 方式 A 下**伪装皮肤无意义**（log/terminal/diff 是为了不被看出在读小说）→ 侧栏强制 plain；
> 皮肤设置只对方式 B 生效。同理"面板宽度"设置只对方式 B 生效（宽度由宿主管）。

## 3. 表格暴露的三类问题

### 3.1 显示值与实际值不一致（4 项）

| 项 | 用户看到 | 实际 | 实测证据 |
|---|---|---|---|
| `fontSize` @ 3 皮肤 | 15 | 14px | want 15 → got `14px` |
| `lineHeight` @ 3 皮肤 | 1.9（≈28.5px） | 24.5 / 23.8px | want 28.5 → got `24.5px` / `23.8px` |
| `font` @ 4 皮肤 | Georgia（选 serif） | `ui-monospace…` / `"PingFang SC"` | 选什么都被覆盖 |
| `cardFoldDelay` 存 1500 | 滑杆顶在 800，旁印 `1500ms` | 真的用 1500 | 两侧夹取不同 |

### 3.2 死代码 / 无效控件（2 项）

- `stripStep`：无控件、无读取、无渲染，只有 `DEFAULT_SETTINGS` 一处 + 两条语言串 + README 一处承诺。
- `cardOffset`：折叠条形态与"不可折叠"时不隐藏，而它只作用于圆标。

### 3.3 文档看走眼（2 项）

- README:86 说修复选择器在书籍页 **Advanced** 里"默认收起"；代码里 `<details>` 计数为 **0**，两个输入框常驻。
- `barCoverText` 默认值是硬编码英文 `'Reading notes'`，而预设按钮用 `t('barCover_notes')` 比较；中文下
  是 `阅读笔记` ≠ `Reading notes`，**四个预设一个都不亮**。

## 4. 未实测的部分（诚实标注）

- `scrollMode: 'continuous'` 在卡片下无效这一条，来自源码阅读（卡片不含 `continuous` 分支），
  **未做浏览器行为验证**——它需要模拟滚动，超出静态排版测量范围。分级：**推断**。
- 侧栏 `.sr-panel-sidebar` 宽度实测 1280px 是在 1280 宽视口下的结果；若宿主改变侧栏宽度策略，
  结论需重测。分级：**实测（单视口）**。
- `skin` 的"只改措辞不改外观"对卡片，实测的是 CSS 计算值；屏幕阅读层面未验证。分级：**实测（样式层）**。
