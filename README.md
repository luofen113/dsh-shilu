# dsh-shilu

**给 DeepSeek Harness（DSH）的两个插件，加一套「实录体例」。**

- `shilu/` —— **实录素材官**：按日取会话事实，摊平成「当日素材」，供 agent 执笔写实录
- `chronicle/` —— **会话档案器**：把会话事件流转成「档案」与「纪事」两个投影单元
- `docs/` —— 体例（凡例）与读法协议
- `yardsticks/` —— 四把自检尺子（见下）

> 出典：丙午年九月十五日（2026-09-15）立。原本是一台 Windows 机器上的私人史书体制，
> 抽其可复用者成此仓。
>（仓库给的是插件 + 体例 + 尺子三件套，实录本身要你自己起。体例是你定的，笔是 agent 执的，插件只供料。“插件供料，agent 执笔，实录即成品”）

---

其他用户要建立自己的实录，核心流程是：**装插件 → 配体例 → 起实录 → 日常维护**。下面按步骤说明。

**工程说明**见第一、七、十、十一节（插件职责 · 尺子 · 脱敏 · 许可）；**步骤说明**见第二至六、八、九节（前置 · 装法 · 体例 · 起实录 · 流程 · 注意事项 · 最小路线）。

---

## 一、两插件各做什么

### `shilu` —— 素材官（**只供料，不执笔**）

| 工具 | 做什么 |
|---|---|
| `shilu_materials({date, maxChars})` | 取某日**全部会话**的事实（主上之命、工具调用、触及文件、报错、轮次结局），人可读 + 带计数。**不归类、不写文件** |
| `handnote_write({to, subject, body, author, evidence, dryRun})` | 往实录「卷三 · 共用手记」**追加**一札（只增不改）。**`author` 必填**；可先 `dryRun:true` 试看 |

**红线**：不监听事件流 · 不注册投影单元 · 不产日稿文件 · 不写正文 · 不代归类。
一句口诀：**插件供料，agent 执笔，实录即成品**。

### `chronicle` —— 档案器

把 `session/event` 折成两个投影单元：`chronicleDossier`（实体档案：文件、路径、主题）与
`chronicleNarrative`（纪事：去重主题与草稿）。读多帧 zstd 日志（`lib/replay.mjs`）。

---

## 二、前置条件

需要满足：

- 已安装 DSH（DeepSeek Harness），且 `dsh web` 能正常启动
- 本机有 Node.js 和 pnpm
- 有一个可用的 agent preset（小鲸/初初那样的人设，或自己的）

---

## 三、装插件（**务必先打包**）

DSH 的插件是 Cordis 插件，经 profile 挂载。**不可用 `link:` 或 `file:<目录>` 安装** ——
Node 按 **realpath** 解析依赖，插件真身留在工作区时 `zod` 等依赖会找不到
（实测：`Cannot find package 'zod' imported from ...`）。**正法是打包成 tgz**：

```bash
# 1. 克隆仓库
git clone https://github.com/luofen113/dsh-shilu.git
cd dsh-shilu

# 2. 打包 shilu
cd shilu
pnpm pack --pack-destination ../_packed

# 3. 装入 web profile
dsh plugin --profile web add "file:<绝对路径>/_packed/dsh-shilu-0.1.0.tgz"

# 4. chronicle 同理
cd ../chronicle
pnpm pack --pack-destination ../_packed
dsh plugin --profile web add "file:<绝对路径>/_packed/dsh-chronicle-0.1.0.tgz"
```

装了 tgz，`node_modules` 下得到的是**真副本**，依赖方可解析。

**改代码后**：重新打包 → 先 `dsh plugin --profile web remove dsh-shilu` 再 `add`
（同版本号时 pnpm 增量解析会沿用旧记录）。**宿主半侧的插件代码、agent preset、配置树
三类改动皆须重启 `dsh web` 方生效。**

---

## 四、配体例

`shilu` 启动时读 **`docs/体例.md`** 作为体例真源。这是你要改的核心文件。

体例里需要定的：

| 项 | 默认值 | 你要改的 |
|---|---|---|
| **年号** | 景和 | 改成你自己的 |
| **元年** | 2026 | 若从今年起算，可留 |
| **干支历法** | `(jdn + 49) % 60` | 公式通用，不必改 |
| **朔日** | 公历月首 | 按你的定义 |
| **记录政策** | 必录/选录/不录 | 按需调整 |
| **卷三格式** | 短札体 | 按需调整 |

体例分两部分：**散文说理 + YAML 定式**（历法/干支/分录/手记/校验）。人读散文，机器读 YAML。
**改规则 = 改体例，不改代码。**

**体例读不通时**：`shilu` 只停该单元并告警（含行号），**绝不阻 `dsh web` 启动**。

把体例放到一个固定路径，比如 `F:\AI\DSH\实录凡例.md`，在 `AGENTS.md` 里指给它。

另有一份 **`docs/读法协议.md`** —— 实录该怎么分读（四层）、读取顺序为何要「由稳到变」
（缓存前缀），以及几条本机红线（含中文的 `.ps1` 必 UTF-8 with BOM 等）。

---

## 五、起实录

实录本身就是一个 **markdown 文件**，由 agent 执笔，手工或半自动维护。

### 建议的分卷结构

```
DSH实录\
├── 00-体例.md          ← 卷首宪法层（极少改，缓存前缀）
├── 01-总目.md
├── 10-卷一-<agentA>.md ← 各写各的
├── 20-卷二-<agentB>.md ← 各写各的
├── 30-卷三-手记.md     ← 双方追加
├── 40-附录.md
└── 90-候重启.md        ← 状态表
```

分文件的好处：**卷一、卷二彻底无冲突**，卷三追加式写入，卷首体例独立且稳定（缓存永远命中）。

### 读法协议

把 `docs/读法协议.md` 的内容改写进你自己的 `AGENTS.md`，核心是**四层分读，不通读全本**：

| 层 | 读什么 | 量 |
|---|---|---|
| **宪法**（必读） | 卷首（总序/体例/纪元/总目）+ 附录八《候重启》 | ~8K 字 |
| **本方近况** | 本方卷近三日 + 本方艺文志 | ~15K 字 |
| **对方牵动** | 卷三近三札 + 对方卷中涉本方之节 | ~5K 字 |
| **历史** | 按需 grep / FTS5 | 按需 |

**缓存前缀之序**（由稳到变）：体例 → 纪元 → 总目 → 本方所读之卷 → 卷三 → 候重启表。**候重启表与卷三末札变得最勤，务必最后读**（它们一变，其后缓存全废）。

**谷时**：日常记录随时；批量复扫、重折、大检索挪到夜里或周末 —— 峰谷价差可至两倍。

---

## 六、日常使用流程

```
1. agent 开工前，按读法协议分层读实录
2. 做完事，agent 调用 shilu_materials({date}) 取当日素材
3. agent 读素材，照体例笔法，直接写进实录当天那一节
4. 牵动对方职分的，调用 handnote_write 往卷三追加一札
5. 改了口径/体例，改体例文件 + 重启 DSH
```

**shilu 的两个工具**：

| 工具 | 作用 | 约束 |
|---|---|---|
| `shilu_materials({date, maxChars})` | 取某日**全部会话**的事实 | 不归类、不写文件 |
| `handnote_write({to, subject, body, author, evidence, dryRun})` | 往卷三追加一札 | **只增不改**；`author` 必填；可先 `dryRun:true` 试看 |

**红线**：不监听事件流 · 不注册投影单元 · 不产日稿文件 · 不写正文 · 不代归类。**插件供料，agent 执笔，实录即成品**。

---

## 七、尺子（改完必跑）

| 尺 | 验什么 | 怎么跑 |
|---|---|---|
| `yardsticks/shilu/ganzhi-check.mjs` | 日干支公式（六条自检向量，取自实录既有日名） | `node ganzhi-check.mjs` |
| `yardsticks/shilu/test-shilu.mjs` | 四项自验：凡例解析 / 故障态 / 素材对账 / 卷三试写（真本哈希须不变） | `node test-shilu.mjs` |
| `yardsticks/shilu/test-render.mjs` | 工具定义的 `render` 契约（**因线上真 bug 而立**） | `node test-render.mjs` |
| `yardsticks/shilu/test-author.mjs` | `authorOf` 署名契约（**因线上真 bug 而立**：默认值恰是作者本人，故自测不可见） | `node test-author.mjs` |
| `yardsticks/chronicle/rule-drift-check.mjs` | 口径副本对账：代码常量 vs README vs 实录 | `node rule-drift-check.mjs` |

```bash
node yardsticks/shilu/ganzhi-check.mjs   # 干支公式自检
node yardsticks/shilu/test-shilu.mjs     # 四项自验
```

`chronicle` 也可独立验证：

```bash
node chronicle/lib/replay.mjs --last     # 回放最近一条会话
node chronicle/lib/replay.mjs --all      # 回放全部
```

`replay.mjs` 用**同一份折叠定义**直接读 `~/.dsh/sessions/**/session*.jsonl.zstd` 复算，既能验折叠逻辑，也能随时查历史会话。

三条教训（都付了学费）：

1. **凡新器，须实调一次，方算验过** —— 脚本自测全绿也可能照不到「壳之契约」那一层。
2. **`render` 要写在 `output` 之内**（`defineTool` 读 `options.output.render`）。
3. **尺子自己也会错** —— 验器先验其器。

---

## 八、注意事项

1. **插件入册走正门**：`dsh plugin --profile web add file:<tgz>`，先 `pnpm pack`。`link:` / `file:<目录>` 装出来的插件依赖解析不通。

2. **自带 `cordis.patch.yml` 者由 bundles 挂载**，profile 的 patch 里**勿再写同 id 的 insert** —— 否则两处各插一次，全树 `id: chronicle` 出现两行，立停复查。

3. **`author` 必填**（卷三署名）：自报家门，不靠猜。会话头的 `agentPreset` 只是「会话创建时」的快照，界面上换了预设不会更新它。

4. **认文件名别只认前缀**：会话日志当前是 `session.v3.jsonl.zstd`，格式代号夹在中间。按 `session.jsonl*` 匹配会整代漏掉。

5. **改折叠语义，必 bump `stateVersion`**：投影是自持久化 checkpoint 增量续折，不 bump 则新码抱着旧脏数据跑。

6. **含中文的 `.ps1` 必 UTF-8 with BOM**；凡以 PowerShell 数行、切行者，必加 `-Encoding UTF8`。

---

## 九、最小可行路线

如果不想一次全上，可以按这个顺序：

1. **只装 `shilu`** —— 先能用 `shilu_materials` 取当日素材
2. **手工起一本实录** —— 一个 md 文件，agent 按体例写
3. **加读法协议** —— 写进 `AGENTS.md`，分层读
4. **按需加 `chronicle`** —— 需要实体档案与专题线时再装
5. **分文件** —— 两个 agent 同时跑且冲突频繁时再拆

---

## 十、关于脱敏

本仓为**发布副本**，已做脱敏（人名一律作 `<user>`、称谓作「主上」）。**本机真源未改一字** ——
发布之物与原物之别，仅在人名字串。

- 保留 `F:\AI\DSH\` 这一层目录结构：非人名、非凭据，便于读者对照体例原文。
- **未收录**：实录全文（含二人私人对话与本机细节）、注册表备份、数据快照、任何密钥。
- 发布前检查：`scan-secrets.mjs`（高危=密钥/SID/私钥；中危=人名与用户目录）。
  **高危或中危命中即退出码 1，不得 `git add`。**

## 十一、许可

代码 MIT（见 `LICENSE`）；`docs/` 下文档另可依 CC BY 4.0 取用。

---

**一句话**：仓库给的是**插件 + 体例 + 尺子**三件套，实录本身要你自己起。体例是你定的，笔是 agent 执的，插件只供料。**“插件供料，agent 执笔，实录即成品”** —— 这句口诀就是全部流程。
