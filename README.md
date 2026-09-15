# dsh-shilu

**给 DeepSeek Harness（DSH）的两个插件，加一套「实录体例」。**

- `shilu/` —— **实录素材官**：按日取会话事实，摊平成「当日素材」，供 agent 执笔写实录
- `chronicle/` —— **会话档案器**：把会话事件流转成「档案」与「纪事」两个投影单元
- `docs/` —— 体例（凡例）与读法协议
- `yardsticks/` —— 四把自检尺子（见下）

> 出典：丙午年九月十五日（2026-09-15）立。原本是一台 Windows 机器上的私人史书体制，
> 抽其可复用者成此仓。
（仓库给的是插件 + 体例 + 尺子三件套，实录本身要你自己起。体例是你定的，笔是 agent 执的，插件只供料。“插件供料，agent 执笔，实录即成品”）
---

## 一、两插件各做什么

### `shilu` —— 素材官（**只供料，不执笔**）

| 工具 | 做什么 |
|---|---|
| `shilu_materials({date, maxChars})` | 取某日**全部会话**的事实（主上之命、工具调用、触及文件、报错、轮次结局），人可读 + 带计数。**不归类、不写文件** |
| `handnote_write({to, subject, body, evidence, dryRun})` | 往实录「卷三 · 共用手记」**追加**一札（只增不改）。可先 `dryRun:true` 试看 |

**红线**：不监听事件流 · 不注册投影单元 · 不产日稿文件 · 不写正文 · 不代归类。
一句口诀：**插件供料，agent 执笔，实录即成品**。

### `chronicle` —— 档案器

把 `session/event` 折成两个投影单元：`chronicleDossier`（实体档案：文件、路径、主题）与
`chronicleNarrative`（纪事：去重主题与草稿）。读多帧 zstd 日志（`lib/replay.mjs`）。

---

## 二、装法（**务必先打包**）

DSH 的插件是 Cordis 插件，经 profile 挂载。**不可用 `link:` 或 `file:<目录>` 安装** ——
Node 按 **realpath** 解析依赖，插件真身留在工作区时 `zod` 等依赖会找不到
（实测：`Cannot find package 'zod' imported from ...`）。**正法是打包成 tgz**：

```powershell
cd shilu
pnpm pack --pack-destination ..\_packed
dsh plugin --profile web add "file:<绝对路径>/dsh-shilu-0.1.0.tgz"
```

装了 tgz，`node_modules` 下得到的是**真副本**，依赖方可解析。

**改代码后**：重新打包 → 先 `dsh plugin --profile web remove dsh-shilu` 再 `add`
（同版本号时 pnpm 增量解析会沿用旧记录）。**宿主半侧的插件代码、agent preset、配置树
三类改动皆须重启 `dsh web` 方生效。**

---

## 三、体例与读法

- `docs/体例.md` —— **体例真源**：人读散文 + 机器读 ```yaml 围栏块（历法/干支/分录/手记/校验）。
  `shilu` 启动时读它；**读不通则该单元不启用并告警（含行号），绝不阻 `dsh web` 启动**。
  **改规则 = 改凡例，不改代码。**
- `docs/读法协议.md` —— 实录该怎么分读（四层）、读取顺序为何要「由稳到变」（缓存前缀）、
  以及几条本机红线（含中文的 `.ps1` 必 UTF-8 with BOM 等）。

---

## 四、尺子（改完必跑）

| 尺 | 验什么 | 怎么跑 |
|---|---|---|
| `yardsticks/shilu/ganzhi-check.mjs` | 日干支公式（六条自检向量，取自实录既有日名） | `node ganzhi-check.mjs` |
| `yardsticks/shilu/test-shilu.mjs` | 四项自验：凡例解析 / 故障态 / 素材对账 / 卷三试写（真本哈希须不变） | `node test-shilu.mjs` |
| `yardsticks/shilu/test-render.mjs` | 工具定义的 `render` 契约（**因线上真 bug 而立**） | `node test-render.mjs` |
| `yardsticks/shilu/test-author.mjs` | `authorOf` 署名契约（**因线上真 bug 而立**：默认值恰是作者本人，故自测不可见） | `node test-author.mjs` |
| `yardsticks/chronicle/rule-drift-check.mjs` | 口径副本对账：代码常量 vs README vs 实录 | `node rule-drift-check.mjs` |

三条教训（都付了学费）：

1. **凡新器，须实调一次，方算验过** —— 脚本自测全绿也可能照不到「壳之契约」那一层。
2. **`render` 要写在 `output` 之内**（`defineTool` 读 `options.output.render`）。
3. **尺子自己也会错** —— 验器先验其器。

---

## 五、关于脱敏

本仓为**发布副本**，已做脱敏（人名一律作 `<user>`、称谓作「主上」）。**本机真源未改一字** ——
发布之物与原物之别，仅在人名字串。

- 保留 `F:\AI\DSH\` 这一层目录结构：非人名、非凭据，便于读者对照体例原文。
- **未收录**：实录全文（含二人私人对话与本机细节）、注册表备份、数据快照、任何密钥。
- 发布前检查：`scan-secrets.mjs`（高危=密钥/SID/私钥；中危=人名与用户目录）。
  **高危或中危命中即退出码 1，不得 `git add`。**

## 六、许可

代码 MIT（见 `LICENSE`）；`docs/` 下文档另可依 CC BY 4.0 取用。
