# 设计记录 — stealth reader

本文件记录讨论中的设计决策与已核实的 DSH 契约，供后续实现对照。
代码未随本文件改动。

---

## D1 · 设置独立成页 + 选好即默认

**状态：方案已定，待拍板细节后实现**

### 现状诊断

大部分设置项**已经**持久化并会在启动时生效：

| 项 | 宿主存储 | 客户端读取 |
| --- | --- | --- |
| `skin` / `fontSize` / `width` / `lineHeight` / `font` / `scrollMode` / `libraryDirs` | `lib/index.js` 的 `DEFAULT_SETTINGS` + `updateSettings()` 白名单 | `refresh()` → `setSettings(state => ({...state, ...data.settings}))` |

真正缺的是"位置"与"写入可靠性"：

| 现象 | 位置 | 根因 |
| --- | --- | --- |
| 连续模式每次打开面板回到该章开头 | `client.js` 的 `continuousTopRef` | 宿主只记 `positions[bookId]=index`，不记章内/列内偏移 |
| 单章模式翻回上一章回到章首 | `scrollPositions` | 只在内存 |
| 拖完滑块看着生效、重启又变回 | `changeSetting` 的 `catch {}` | 写盘失败被吞，界面值与落盘值可能不一致 |
| 滑块每动一格写一次整份状态文件 | `index.js` `await this.save()` | 无去抖 |

### 方案

1. **设置独立成页**：面板从"阅读 / 书库"两个视图扩展为"阅读 / 书库 / 设置"三个互斥视图。
   复用书库抽屉已有的外壳（`position:absolute;inset:0;z-index:2` + `role="dialog"` + Esc + 焦点归还），
   设置页用**覆盖层**而不是插入正文——避免卸载 body（卸载会丢滚动监听器），也避免正文被挤矮。
2. **三层默认值**：L0 内置默认（`DEFAULT_SETTINGS`）/ L1 用户已保存（落盘）/ L2 会话内临时。
   设置页底部加"恢复默认"回到 L0。
3. **写入策略**：本地立即生效 + 300ms 去抖落盘；写盘失败必须出声（走 `setError`/`setNote`）；关闭设置页时 flush。
4. **读位恢复**：`positions[bookId]` 从 `number` 扩展为 `{ index, offset, mode }`，读取端兼容旧格式，
   `STATE_VERSION` 做一次迁移。滚动停止 300ms 后上报。

### 待拍板

- 设置界面放哪：面板内独立页 / Harness 全局浮层 / Harness 插件设置页
- 表头的 `⤓`/`▤` 快捷按钮留不留
- 读位记到什么粒度

---

## D2 · 呈现方式（"隐藏方式"）三种

**状态：方式 A、C 已由用户提出并核实了 DSH 契约；方式 B 的形态待确认。本节只记录，不改代码。**

用户的判断：现在"浮在右下角、自己画几何、带一个 peek 小箭头"的形态不好。分成三种：

- **方式 A — 不需要隐藏**：放进 DSH 的正常右侧栏（用户在截图里箭头指向的那个右上角按钮打开的面板）。
- **方式 B — 需要隐藏**：保留悬浮/伪装的形态（具体形态待定，见下）。
- **方式 C — 极简**：对话框（输入框）上方一张卡片，只显示 1–2 行，像"排队的对话"或"目标"。

### 已核实的 DSH 契约（来源：`@deepseek-ai/dsh-client-ui-sidebar-right/README.md`、`@deepseek-ai/dsh-client-ui-layout/README.md`、技能参考 `ui-plugin.md` / `practices.md`）

右侧栏是**按会话**的官方表面，插件作为 tab type 接入，两阶段注册：

```js
// 1) 类型（静态声明，放在 ctx.effect 里）
ctx.sidebarRightTabs.register({
  id: 'dsh-plugin-stealth-reader',
  kind: 'dsh-plugin-stealth-reader/reader',
  title: () => t('reader'),
  guide: [{ id: 'reader', label: ..., description: ... }],  // 出现在"添加标签"的指南页
  keepMounted: true,                                          // 切走时保留正文
})

// 2) 正文（键 = 类型 id）
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, ReaderBody)
// Body 通过 useTabInfo() 读 { sidebar, panel, tab }
```

打开与导航：`ctx.sidebarRight.openTab(kind, options?)`、`openResource(address, options?)`、
`toggleExpanded()` / `isExpanded()`、`close/hide/focus/split/float/dock`。
`openTab` 支持 `destination: 'sidebar' | 'float'` —— **同一个 tab type 也能开成 dockkit 浮窗**。

宿主提供、插件不再自己画的：

- 右侧栏**没有自己的表头**（README：「The panel has no header row」），两个控件（呈现切换 / 收起）
  挂在标签条末端，标签条就是面板的整个上边缘。
- 宽度：首次按视口 45% 打开，之后记住用户偏好，上限 70%；中心区保底 400px，必要时降到 300px 再让占用方关闭。
- 呈现：`push`（正常）与 `fullscreen`（全屏）；窄于 768px 自动全屏。
- 布局按会话存在 `localStorage`（`dsh.sidebar-right.v1.<sessionId>`），切换会话互不干扰。
- 主题、深浅色、指南页的胶囊入口、标签生命周期。

约束与后果：

- **没有会话就没有右侧栏**（README：「Without a session there is no button and no panel」）→
  用户截图的首页上侧栏模式不存在；要在家读只能用方式 B。
- 方式 A 下**插件自己的那排表头按钮**（`‹ › A- A+ ⤓ ◐ ☷ ⚙ ☰ ✕`）要收成正文内的一条紧凑工具条，
  否则会出现两个表头。
- 方式 A 下**伪装皮肤无意义**（log/terminal/diff 是为了不被看出在读小说）→ 侧栏强制 plain；
  皮肤设置只对方式 B 生效。同理"面板宽度"设置只对方式 B 生效（宽度由宿主管）。
- `package.json` 的 `dsh.client.inject` 需要补 `@deepseek-ai/dsh-client-ui-sidebar-right`；
  客户端取 `ctx.sidebarRight` / `ctx.sidebarRightTabs` 要走 `ctx.inject([...], ...)`，
  这样在没装侧栏的 profile 里插件不会抛错（`practices.md`：「Put optional services in inject」）。
- 平台指引本身就偏向方式 A：`ui-plugin.md`「prefer a slot with allocated space … Use `shell.overlay`
  only when the request needs an overlay and its placement is known」；
  `practices.md`「Choose the rendering surface before writing any view; styling inside the wrong
  surface cannot recover consistency」。现状正是"在错误的表面上自己画几何"。

### 方式 B 的三个候选

| 候选 | 做法 | 代价 |
| --- | --- | --- |
| B1 保留现状 | 继续用 `shell.overlay` 自绘浮层（`.sr-root` + `.sr-panel` + `.sr-peek`） | 几何/层级/点击穿透全部自己维护；与宿主外观容易脱节 |
| B2 dockkit 浮窗 | 同一 tab type 用 `openTab(kind, { destination: 'float' })` 开成浮窗 | 浮窗是宿主的原生窗格，可能比自绘 overlay 更显眼 |
| B3 自绘但更"像宿主" | 保留 overlay，尺寸/圆角/配色/控件照抄宿主 | 仍然是自己画的表面 |

### 方式 C — 极简条（输入框上方的卡片，1–2 行）

用户补充：**对话框（输入框）上面**，像"排队的对话"或"目标"那种感觉，只显示 1–2 行。

→ 命中 DSH 的现成表面：**`conversation.input.dock`**。

#### 已核实的契约（来源：DSH 槽位目录 + `dsh-client-ui-conversation/lib/client.js` + `dsh-client-ui-goal/README.md`）

槽位声明（`ui-conversation` 的 `slots.ts`）：

```
"conversation.input.dock": { kind: 'list', scope: 'session' }
```

契约摘要（DSH 槽位目录原文）：
> Full-width entries above the composer card; fixed overlays must portal to the document body
> because the docked composer contains them.

注册形状（DSH 给的官方示例）：

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
      { name: 'conversation.input.dock', id: 'my-entry', order: 100, label: 'My entry' },
      () => React.createElement('div', null, 'hello'),
    ))
  },
}
```

现住客与顺序（渲染成输入框上方的一叠卡片）：

| id | order | 来源 | 长相 |
| --- | --- | --- | --- |
| `todo` | 0 | `ui-conversation` | Todo 卡片 |
| `forge-panel.worktree` | 5 | 实验包 | 工作树进度 |
| `goal` | 10 | `ui-goal` | Goal 卡片（带编辑/清除/暂停） |
| `queue` | 20 | `ui-conversation` | 排队提交（"排队的对话"） |

Goal 包原文：
> the strip then appears as the second card in the composer-context stack (after Todo, before Queue) ……
> Todo and Goal use the same panel elevation above the composer.

消费端（`ui-conversation`）：`renderSlot('conversation.input.dock', zone)` 渲染在
`composerStack` 里、`inputBar`（输入框卡片）**之上**；`zone === undefined` 时不渲染。

#### 方案（已被下面的两条决定取代，保留作背景）

最初设想是做成 `conversation.input.dock` 里的一张普通卡片（像 Todo / Goal 那样）。
读了宿主的 `.composerStack` 布局后发现这条路走不通（见"布局事实"），
所以改为占用 `conversation.input.overlay`、做绝对定位的浮条 + 小图标。


#### 决定：平时藏起来（鼠标靠近 / 按键才出现）

用户已定：**平时藏起来**，靠鼠标靠近或按键才出现；隐藏态留一个**小图标**作为热区。

这是本节最关键的一条设计约束，因为它与宿主布局直接冲突，必须按宿主的机制做。

#### 已核实的布局事实（来源：`dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css` 与 `lib/client.js`）

1. **dock 是一个 flex 纵向列，条目之间有 6px 间距**：
   ```css
   .composerStack {
     --dsh-composer-stack-gap: 6px;
     display: flex;
     flex-direction: column;
     gap: var(--dsh-composer-stack-gap);
   }
   ```
   → **只要这个槽位里有任何条目，它就占高度**（哪怕条目自己渲染 `null`，
   flex 项本身仍在流里、仍然产生 6px 间距）。
   这是"平时藏起来"的第一个硬约束：**不能靠"渲染空内容"来隐藏**。

2. **这个栈是 sticky 的、贴在滚动视口底部**：
   `.root[data-phase='active'] .composerSeat { position: sticky; bottom: 0 }`
   → 条一旦出现，**输入框整体会被顶上去**（flex 列在文档流里），
   正在输入的内容会跟着动，用户正在打字时会被顶开。
   → 隐藏时必须做到 **0 高度**，而不是"很小的高度"。

3. **根节点是定位上下文，专门给槽位用的绝对定位 chrome 留的**：
   `.root { position: relative; /* positioning context for slot-owned absolute chrome */ }`
   → 插件可以把自己渲染成绝对定位，**不占布局**，自己贴在输入框上方。

#### 结论：这条不做成"普通的 dock 卡片"

宿主 `.composerStack` 是 `display:flex; flex-direction:column; gap:6px`，
条目之间恒有 6px 间距；栈是 `position:sticky; bottom:0`，条目一出现会把输入框顶上去。

→ 所以方式 C **不占用 `conversation.input.dock`**，改用 `conversation.input.overlay`
（"Floating entries rendered **inside** the resident composer card"）：
它在输入框卡片**内部**，本来就是浮层，不占文档流位置，也不会在展开时把输入框顶走。

详见下一节。


#### 决定：滚轮推进 + 隐藏态显示一个小图标

用户已定：

1. **推进方式 = 滚轮**（悬停在条上滚动即推进/回退，不滚对话）。
2. **隐藏时不是"什么都没有"，而是留一个小图标** —— 让用户知道这里有东西，
   并且这个小图标本身就是热区。

这条同时解决了上一个问题里"gap 会不会仍然占 6px"的悬念：
**小图标是可以常驻占位的**（它有意的、可见的存在），所以不必强行做到 0 高度。
但仍然建议把图标做在**绝对定位**里，理由见下。

#### 与现有 peek 小箭头的复用

插件已经有一个"隐藏时的常驻小图标"：`.sr-peek`（`lib/client.js:2325-2342`），
右上角那个低对比度的箭头：

```js
: h('button', {
  className: 'sr-peek',
  type: 'button',
  // The button is permanently visible, so its name and its glyph
  // must not identify the panel.
  title: t('openHintNeutral'),
  'aria-label': t('neutralOpen'),
  onClick: () => setVisible(true),
}, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false,
  fill: 'none', stroke: 'currentColor', strokeWidth: 2, ... },
  h('path', { d: 'M14 6l-5 6 5 6' })))
```

CSS（`:379-385`）：30×30、`opacity:.6`、`border-radius:var(--dsw-radius-lg,10px)`、
`border:1px solid var(--sr-line)`、`background:var(--sr-bg)`、`color:var(--sr-muted)`，
hover 变 `--sr-ink`，`:focus-visible` 有 2px `--sr-accent` 描边。

→ **方式 C 的小图标直接沿用这套视觉语言**（同样的尺寸、圆角、边框、低对比度、
同样的中性文案策略），只是位置换到输入框附近。

#### 图标该长什么样（伪装约束）

- 复用现有的 `M14 6l-5 6 5 6` 尖角箭头？它表示"展开"。
  方式 C 的图标同时承担"**这是内容**"和"**靠近就展开**"两个意思，
  尖角箭头偏"展开"，建议换成**三横线**（≡ / 类似菜单但更"文本"）或**竖排短线**，
  读起来像"一段文字的一行"，而不是"一个按钮"。
- **绝对不能**用书本、书页、翻页、眼睛一类的具象图标（会暴露在读小说）。
- 中性文案沿用现有策略：`title` 用 `openHintNeutral` 那样的中性说法，
  `aria-label` 用 `neutralOpen` 这一类。

#### 布局决定：小图标做绝对定位（不占文档流）

宿主 `.composerStack` 是 `display:flex; flex-direction:column; gap:6px`，
条目之间恒有 6px 间距；栈是 `position:sticky; bottom:0`，条目一出现会把输入框顶上去。

→ 小图标**放在输入框卡片内部/边缘的绝对定位位置**（`.root` 本来就是
"positioning context for slot-owned absolute chrome"），
**不作为 flex 项出现在 composerStack 里**。

推荐落点：**输入框卡片的右上角内侧**，一个 20×20 的低对比度小图标。
它属于输入框卡片的一部分（就像 `conversation.input.overlay` 那样），
不会挤压对话区，也不会在打开阅读面板时把输入框顶走。

→ 由此，方式 C 的宿主表面从 `conversation.input.dock` 改为
**`conversation.input.overlay`**（"Floating entries rendered **inside** the resident composer card"）：

```js
ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register(
  { name: 'conversation.input.overlay', id: 'stealth-reader.strip', order: 15, locale: NS },
  StripEntry,
))
```

浮条展开时也仍然是浮层（同样在这个 overlay 槽位里），不回到文档流。

#### 交互（定稿）

| 状态 / 触发 | 表现 |
| --- | --- |
| 平时 | 输入框右上角一个 20×20 低对比度小图标（≈`opacity:.5`），无文字 |
| 鼠标悬停图标 | 图标变亮（`opacity:1`），**浮条淡入**：显示当前 1–2 行 + 极小的推进/展开按钮 |
| 鼠标停在浮条上、滚轮 | **推进/回退正文**（`preventDefault` 阻止对话滚动），每格一行，按住加速 |
| 滚轮滚到两端 | 边界处不滚（到书首/书尾时不再消费滚轮，让对话能正常滚动） |
| 离开图标/浮条 | 延迟 400–800ms 淡出（掠过时不闪） |
| 点击图标 | 打开阅读面板（方式 A 侧栏 / 方式 B 浮层），沿用 ⌃⌥N 的同一个动作 |
| 点击浮条正文 | 同上 |
| 键盘 | 图标 `tabIndex=0`，`focus` 也展开浮条；`Esc` 收起并把焦点还给图标 |
| 减弱动效 | `prefers-reduced-motion` 时不淡入淡出，直接显示/隐藏 |

#### 实现要点

- 滚轮要用 `{ passive:false }` 才能 `preventDefault`；要在**浮条上**才拦截，
  在对话正文上滚动必须照常滚动对话（不能抢）。
- 滚轮事件不能冒泡到对话滚动容器 —— 事件处理里 `stopPropagation()`。
- 推进的节流：滚轮事件很密，按"行"推进要合并（每 60ms 最多推一次），
  否则一格滚轮能跳过好几行。
- 浮条内容仍受伪装约束：不出现书名、章节名；标签用中性词。
- 图标不能是 `pointer-events:none`（它就是热区）；浮条展开后热区要覆盖浮条本身，
  否则鼠标从图标移到浮条时浮条会消失。

#### 连带影响

- 该槽位 `scope: 'session'` → **没有会话时这条不存在**（首页没有输入框卡片，也就没有这条）。
  这与方式 A 侧栏"没有会话就没有面板"是同一条限制。
- 插件 `package.json` 的 `dsh.client.inject` 需要补 `@deepseek-ai/dsh-client-ui-conversation`
  （`conversation.input.dock` / `conversation.input.overlay` 由它声明）。
- 插件已经注入了 `@deepseek-ai/dsh-client-shortcuts` 并用 `shortcuts.registerFixed` 注册 ⌃⌥ 组合键，
  新增 ⌃⌥↓/↑ 沿用同一机制即可（注意 `chordAllowed()`：面板外的输入框里打字时不劫持按键）。
- 方式 C 与 A / B 的关系：条是入口，点开成 A 或 B；也可以三选一（设置里选）。

#### 待确认

1. 推进方式：滚轮 / ⌃⌥↓↑ / 定时自动走
2. 卡片上要不要一个标签（"Document 1" / 无标签）
3. 隐藏时是否留一个"极小的提示"（例如输入框上沿一条 1px 的细线），让用户知道这里有东西

### 待拍板

1. 方式 B 用 B1 / B2 / B3？
2. 侧栏模式下要不要保留伪装皮肤？（建议不要）
3. 没有会话时侧栏模式不可用：是完全不提供入口，还是保留一个小的 overlay 入口兜底？
4. 方式 C 与 A / B 的关系：条是三者共同的入口（点开成 A 或 B），还是三选一？
5. 两种方式能否同时存在（侧栏读 + 浮层读）？建议"同一时刻只出现一个"，由设置里的"位置"一项切换。

---

## 已落地的 review 修复（`lib/client.js`，md5 `d3ab872c920c20150ae3d9d035d86029`）

| 项 | 状态 |
| --- | --- |
| M1 滚动监听器随节点失效 | ✅ `bodyNode` 提到 state，effect 依赖它 |
| M2 `foundListRef` 未定义（搜索结果崩溃） | ✅ 已声明，焦点 effect 也改用它 |
| M3 段落 key 随窗口滑动漂移 | ✅ key 改为 `${item.index}:${lineIndex}` |
| M4 `neutralZoomUp` 缺词条 | ✅ 已补 |
| S1 终端皮肤章节分隔不可读 | ✅ 已加 `[data-skin=terminal]` 覆盖 |
| S2 模式按钮泄露"chapter"词汇 | ✅ `neutralModeSingle` / `neutralModeContinuous` |
| S3 匹配数只算锚点章 | ✅ 连续模式下按整列统计 |
| S4 加载中/到书尾无提示 | ✅ `loadingMore` / `endOfBook` |
| S5 失败后每次滚动都重试 | ✅ `failedRef` 记住失败索引 |
| S6 `scrollIntoView` 滚动整个页面 | ✅ 改为手工设置 `scrollTop` |
| S7 翻章整份状态写盘 | ◐ 客户端改用新的 `position` 动作且带单调序号，但宿主 `position()` 仍每次 `await this.save()` |
| C1 320px 表头换行、标题消失 | ✅ `.sr-name` 改为 `flex:1 1 auto;min-width:42px` |
| C3 切模式丢章内位置 | ✅ 用 `scrollPositions` 里的偏移量续上 |
| C4 `chapterAtTop` 在 scrollTop=0 失效 | ✅ 阈值改为 32 |
| C5 滚动补偿漏掉章节间距 | ✅ 引入 `CHAPTER_GAP = 16` |
| C6 页脚/diff 头只算锚点章 | ⬜ 未做 |

---

## 遗留项

- 宿主 `position()` 每次写整份 `state.json`（`index.js` 的 `await this.save()`）→ 连续模式翻章仍有磁盘写。
- 读位只存章节号，不存章内偏移 → 重新打开面板仍回到章首（D1 的第 4 条）。

---

## 已实现（D1 + D2，2026-11-13）

### 宿主（`lib/index.js`）

| 改动 | 位置 | 说明 |
| --- | --- | --- |
| `placement` 进入设置白名单 | `DEFAULT_SETTINGS` / `updateSettings()` | 默认 `'overlay'`；非法值回落默认，不会让读者没有落点 |
| `reset_settings` 动作 | `handle()` | 恢复 `{...DEFAULT_SETTINGS, libraryDirs}`，不动书库 |
| 读位结构 `{index, offset, line, mode}` | `position()` / `open()` | `offset` 是像素（面板），`line` 是章内行号（细条），`mode` ∈ `{overlay, sidebar, strip}` |
| 旧格式兼容 | `migratePositions()` | 旧的数字读位 → `{index, offset:0, line:0, mode}` |
| 写盘去抖 | `scheduleSave()` | 一串翻章只落一次盘 |

### 客户端（`lib/client.js`）

**共享状态**：模块级 `readerStore`（`get` / `set` / `subscribe` / `reset`）+ `useReaderState()`
（`React.useSyncExternalStore`，宿主模块表里有 `react`）。三种呈现方式共用一份状态，
所以"面板开在哪""读到哪""设置页开没开"在各个表面之间是一致的。

**设置独立成页**：`SettingsPage` 组件，**放在读者所在的位置**（浮层模式 = 右下角卡片，
侧栏模式 = 侧栏面板内），面板与设置页**互斥**：要么读，要么设置，不同时出现。
复用书库抽屉的外壳（`role="dialog"` + Esc + 焦点归还）。**没有**把设置做成面板里的第三个视图——
那样会卸载 body，滚动监听器就没了；读位现在由宿主保存，所以重新挂载也能续上。
放置位置的选择器 + "恢复默认" → `call('reset_settings')`。
写盘失败不再吞掉：页面底部有 `role="alert"` 的错误行。

**三种呈现方式**：

| 方式 | 表面 | 槽位 |
| --- | --- | --- |
| A 浮动面板 | `OverlaySurface` | `shell.overlay`（order 95） |
| A' 右侧栏 | `SidebarSurface` | `sidebar.right.pane.tab`（key `dsh-plugin-stealth-reader`） |
| C 输入框上方细条 | `StripEntry` | `conversation.input.overlay`（order 15） |

- 侧栏用 DSH 官方的两段式注册：`ctx.sidebarRightTabs.register(...)` +
  `ctx.slots.register({name:'sidebar.right.pane.tab', key, locale})`。整段包在
  `ctx.inject(['sidebarRight','sidebarRightTabs'], …)` 里，**没有侧栏时插件照常活着**。
  侧栏没有插件自己的表头行，所以关闭按钮交给侧栏自己，面板里不画 ✕。
- 细条用 `conversation.input.overlay`（**不是** `conversation.input.dock`）：
  dock 的条目是 `.composerStack` 的 flex 子项（`gap:6px` + `position:sticky`），
  会把输入框顶上去；overlay 槽位的宿主样式是 `.overlayAnchor{position:absolute;inset:0 0 auto;height:0}`，
  零布局代价。
  **宿主对这个槽位的约定**（源码注释原文）："entries position themselves against the card
  (bottom: 100% + gap)" —— 所以细条用 `bottom:100% + margin-bottom:6px`，
  落在品牌与输入框之间的空隙里，而不是插进输入框卡片内部。
- 细条的图标：20×20、`opacity:.5`（hover/focus → 1）、`--dsw-radius-lg` 圆角、
  `1px solid var(--sr-line)`、`background:var(--sr-bg)`、`color:var(--sr-muted)`，
  图形是**三条横线**（不是书、翻页或眼睛）。`title` / `aria-label` 都是中性词。
- 滚轮：细条上 `preventDefault` + `stopPropagation`，按**行**推进，跨章；60ms 节流；
  到书首/书尾时**不劫持**滚轮，页面照常滚动。
- 细条隐藏：默认只有小图标；鼠标靠近 / 键盘 focus 展开成 1–2 行；600ms 后收起；
  `Esc` 收起并把焦点还给图标。
- 伪装约束：伪装皮肤下细条只显示 `Document N · Section M`，不显示书名、章节名和正文。
  `N` 是**书库里的序号**（与书库抽屉的编号一致），不是章节数。

**兜底**：侧栏打不开（没有会话、侧栏服务缺失、`openTab` 抛错）时，
`openReader()` 置 `sidebarUnavailable`，浮层接管面板——读者永远有地方可读，
不会因为选了侧栏就消失。

**读位**：行级。宿主记 `{index, offset, line, mode}`；
面板滚动停止 500ms 后上报 `offset` + `line`（`lineAtTop()` 读 `[data-row]`）；
细条推进时上报 `line`；面板打开时若内存里没有偏移，就用宿主的 `offset` 恢复，
再按 `line` 定位到 `[data-row="N"]`。**同一时刻只出现一个表面**，由 `placement` 决定。

**包依赖**：`package.json` 的 `dsh.client.inject` 补了
`@deepseek-ai/dsh-client-ui-conversation`（声明 `conversation.input.overlay`）
和 `@deepseek-ai/dsh-client-ui-sidebar-right`（声明 `sidebar.right.pane.tab`）。

### 与宿主契约的逐条核对（读已安装源码）

| 契约 | 出处 | 本插件的用法 |
| --- | --- | --- |
| `conversation.input.overlay` = `{kind:'list', scope:'session'}`，注释："entries position themselves against the card (bottom: 100% + gap)" | `dsh-client-ui-conversation/src/client/contract/slots.ts:310`、`skeleton/InputBar.module.css:134` | 细条 `bottom:100%; margin-bottom:6px; right:8px` |
| `sidebar.right.pane.tab` = `{kind:'keyed', scope:'session'}`，派发用 `entryKey: definition?.id ?? tab.kind` | `dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.tsx:221` | 槽位 `key` = 标签定义的 `id` = `dsh-plugin-stealth-reader` |
| 标签定义：`id` 唯一、`kind` 是 `openTab` 的名字、`title(address)`、`guide[]`（`id`/`order`/`title`/`description?`/`icon?`）、`priority` 默认 `'extension'` | `sidebar-right/src/client/tab-registry.ts:94-139, 253-281` | 定义里没有 `patterns`（按 kind 打开的页面型），`icon` 可省（宿主画占位方块） |
| 注册体可以没有 `inject`（`dsh-client-ui-plan` 就是这样注册的） | `dsh-client-ui-plan/src/client/index.ts:109` | 侧栏体只给 `name`/`key`/`locale` |
| `ctx.inject(deps, cb)` 在依赖到位时跑回调 | `cordis/src/registry.ts:300`；`dsh-client-ui-chat/src/client/apply.ts:150` 用的就是 `ctx.inject(['sidebarRightTabs'], …)` | 整段侧栏注册包在 `ctx.inject(['sidebarRight','sidebarRightTabs'], …)` 里 |

### 验证

| 脚本 | 结果 |
| --- | --- |
| `stealth-reader-selftest.mjs` | 18/18 |
| `stealth-reader-crashprobe.mjs` | 36/36（含新增的设置页、放置选择、恢复默认、细条、侧栏体、滚轮、伪装、设置页定位、侧栏兜底九项） |
| `stealth-reader-routetest.mjs` | 25/25（含新增的放置持久化、读位行号、旧格式兼容三项） |
| `stealth-reader-webtest.mjs` | 4/4 |
| `deploy-gate.sh` | 通过（语法 + 中英文词条对齐 128） |

未做（需要先确认）：C6 —— 页脚 / diff 头只算锚点章；
以及宿主 `open()` 仍然每章整份写 `state.json`。

---

## D3 · 设置生效性核查（实测）

**状态：已完成核查，结论见 `../SETTINGS-MATRIX.md`。本节只记录方法论与契约依据，不改代码。**

### 为什么要做这一节

D1 节当时的判断是"大部分设置项**已经**持久化并会在启动时生效"。D3 用真实浏览器
`getComputedStyle` 复核了这句话，结论是：**持久化成立，生效不成立**。
两者是不同的东西，D1 把它们混为一谈了。

### 一手素材（本次核查的起点）

| 素材 | 位置 | 拿到的结论 |
| --- | --- | --- |
| dock 槽位契约原文 | `@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts:301-305` | fixed 覆盖层**必须** portal 到 body |
| 为什么必须 | `.../skeleton/ConversationRoot.module.css:528-536` | `will-change:transform` 使 seat 成为 fixed 包含块 |
| 同源第二条 | 同文件 `:591-594` | 用 flex 而非 absolute+transform，正是为了不缩小 fixed 后代 |
| 侧栏归属 | 本文件 D2 节 | 皮肤与宽度只对伪装形态生效 |
| 渲染事实 | Chrome 157 `getComputedStyle` | 见下 |

### 实测方法

`verify/harness.mjs` 从 `lib/client.js` 里**读出插件真正发布的 CSS**（不重抄一份，
否则测的是副本不是实现），注入无头 Chrome，按真实类名建元素，读回计算样式。
`verify/fontprobe.mjs` 单独读 `font-family`（简写探针会漏它）。

### 实测结论（节选，全表见 SETTINGS-MATRIX.md）

| 皮肤 | 声明字号 | 实际字号 | 声明行高 | 实际行高 |
| --- | --- | --- | --- | --- |
| log | 15 | **14px** | 28.5px | **24.5px** |
| terminal | 15 | **14px** | 28.5px | **23.8px** |
| diff | 15 | **14px** | 28.5px | **23.8px** |
| plain | 15 | 15px | 28.5px | 28.5px |

字体：选 serif 后，四个皮肤计算值分别是 `ui-monospace…`×3 与 `"PingFang SC"`。
卡片：`--sr-font:22px` 下实测 13px，完全不响应。

### 一条被证伪的怀疑

原本怀疑 `StripPopup` 的 `position:fixed` 违反 dock 契约。实测后确认**它是对的**：
该组件渲染在 `shell.overlay`（`lib/client.js:5627`）而非 dock 内，`.overlayLayer` 是
`absolute; inset:0`，祖先 `.frame` 只有 `overflow:hidden`、无 transform，所以 fixed
相对视口正常。记在这里是为了防止后续有人"顺理成章"地把它挪进 dock。

### 设计层面的结论

1. **"设置项"必须区分「存了」与「生效了」。** 二者需要两套测试；现有 218 项测试里
   没有一项检查"改了这个设置，渲染结果变了"。
2. **CSS 覆盖类缺陷单测抓不到。** 三处字号/行高/字体被皮肤覆盖，全部是靠真实浏览器
   测量发现的。这类断言必须进 gate。
3. **契约结论要能被实现校验。** D2 已经写下"侧栏强制 plain"，但代码里侧栏仍在应用
   `data-skin` 与 `--sr-width`。设计记录与实现之间缺一道校验。
