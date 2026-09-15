# dsh-shilu —— 实录素材官

**供料之官**：按日取会话事实，摊平成「当日素材摘要」，供 agent 执笔写《DSH实录》。
**它不写实录**：素材在上下文里，用完即弃 —— **没有日稿这个文件**。

## 一、两个工具

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `shilu_materials({date, maxChars})` | 取某日**全部会话**之素材（主上之命、工具调用、触及文件、报错、轮次结局），人可读 + 计数 | **不归类**（诏令/章奏/决策之分由执笔者作）；不写任何文件 |
| `handnote_write({to,subject,body,author,evidence,dryRun})` | 往《DSH实录》「卷三 · 共用手记」**追加**一札 | **只增不改**；**`author` 必填**；可先 `dryRun:true` 试看 |

> **署名（卷三之「谁致谁」）**：`author` **必填**（`"初初"` / `"小鲸"`）—— **自报家门，不靠猜**。
>
> 自动探测（`authorOf(exec)`）降为**兜底与对账**，其候选路依次为
> `exec.agent.session.header.agentPreset` → `exec.agent.agentPreset` → `exec.agent.preset` →
> `exec.agent.session.agentPreset` → `exec.session.agentPreset` → `exec.session.header.agentPreset`，皆空则落默认「小鲸」。
> **每次调用皆回传一份 `exec` 诊断**（并落 `~\.dsh\shilu-author-probe.json`），供对账；不需要可径删探针。
>
> 2026-09-15 之曲折（初初报、初初修，劳主上重启三次，照实记之）：
> **①** 初初 `dryRun` 实调，署出「**小鲸致小鲸**」—— 旧三路本机皆空，落默认，而**默认值恰是小鲸**，故小鲸自测永不可见（**凡新器，须由第二人实调**）。
> **②** 补会话头一路后**仍署小鲸**，重启确已换代（PID 3904 → 22212）⇒ 非装载之误。
> **③** 改「失败才写探针」后，真调用**竟未写探针** ⇒ 初初醒悟：**不是探不到，是探到了「别的值」**。
> **④** 三版改法：`author` 必填 + 每次回传 `exec` 真形 —— 一次调用即见真相：会话头里写着 **`whale`**，而该会话实为 **`chuchu`**。
>
> **定案：会话头之 `agentPreset` 只是「会话创建时」之快照**，界面上换了预设不会更新它
> （`dsh-agent-presets` 之注释亦明言：*Reconstruction reads the `agentPreset` projection, never the header.*）。
>
> **由此二训**：**「探到了」不等于「探对了」** —— 取上下文之值，须问它是**何时之物**（过时的真值比空值更坏：它连兜底都不会触发）；**写字的人自己知道自己是哪个** —— 故署名以自报为准。
>
> 另立一尺：`dsh-shilu-验证\test-author.mjs`（10 项，测部署副本）。

### 诊断回传之精简（**v4** · 2026-09-15 巳时末 · 主上命「优化」）

`exec` 真形之**详细诊断仍照落** `~\.dsh\shilu-author-probe.json`，然**随工具结果只回一行摘要**：

```
agent=ReactLoopAgent · session.header=true · header.agentPreset=whale · 其余候选路=皆空
```

因由：旧版每次落札回传六十余行 JSON（约 **800 token**），而病已查明（见上），无须逐次铺陈。
源码 `lib\index.js` **10653 → 11427 B**（sha256 前缀 `59D2257C` → **`964E635F`**）；四尺仍全绿
（`test-shilu` 32/32 · `test-render` 8/8 · `ganzhi` 6/6 · `test-author` 10/10）。**宿主半侧之改，须重启 `dsh web` 方生效。**

## 二、它不是什么（红线）

- ❌ **不监听** `session/event`（那本是 `dsh-chronicle` 的职分；两个起居注官会打架）
- ❌ **不注册投影单元**（不为同一批事件折第二遍）
- ❌ **不产日稿文件**、**不写实录正文**（卷三札须 agent 显式调用，且只增不改）
- ❌ **不代归类**（「这件事算决策还是结果」，正是执笔者的活）

## 三、凡例（体例真源）

读 `F:\AI\DSH\实录凡例.md` —— 人的散文 + 机器的 YAML 围栏块。
**解析失败 → 本单元不启用 + 告警写明行号，`dsh web` 照起**（绝不整进程拒启）。

```text
[dsh-shilu] 凡例解析失败：F:\AI\DSH\实录凡例.md:42 第 2 个 YAML 块解析失败 —— ...
[dsh-shilu] → 本单元不启用（其余功能照常；dsh web 不受影响）。修好凡例后重启即可。
```

环境变量（自验用）：`SHILU_RULE` 指凡例副本 · `SHILU_CHRONICLE` 指实录副本 · `SHILU_SESSIONS` 指会话目录。

## 四、入册之法（**不可用 link: 或 file:目录**）

Node 解析依赖按 **realpath** 走：`link:`／`file:<目录>` 装出来的插件，真身在工作区，
其 `import 'yaml'`、`import '@deepseek-ai/dsh-tools'` **会找不到**（实测：
`Cannot find package 'zod' imported from F:\…\dsh-chronicle\lib\projections.js`）。
**正法 = 打包成 tgz 再装**（与仓库包同形，得**真副本**）：

```powershell
cd F:\AI\DSH\大肥鱼\06-插件补丁\dsh-shilu
pnpm pack --pack-destination ..\_packed
dsh plugin --profile web remove dsh-shilu      # 同一版本号亦须先 remove
dsh plugin --profile web add "file:F:/AI/DSH/大肥鱼/06-插件补丁/_packed/dsh-shilu-0.1.0.tgz"
```

改源码后须**重新打包再装**（同一版本号亦然，否则 pnpm 增量解析会沿用旧记录）。
宿主半侧之插件代码，改毕**须重启 `dsh web`** 方生效。

> **备份习惯**：改前先整目录备份到 `06-插件补丁\dsh-shilu-备份-<日期>-<事由>\`
> （例：`dsh-shilu-备份-20260915-署名修正\`，内含改前 `lib\index.js` 6620 B / sha256 前缀 `2AAB8983`）。

## 五、尺子

- `06-插件补丁\dsh-shilu-验证\ganzhi-check.mjs` —— 纪日干支六条自检向量
- `06-插件补丁\dsh-shilu-验证\test-shilu.mjs` —— 四项自验（凡例 / 故障态 / 素材对账 / 卷三试写）
- `06-插件补丁\dsh-shilu-验证\test-render.mjs` —— 工具定义之 `render` 契约（病：写在工具顶层而非 `output` 之内）
- `06-插件补丁\dsh-shilu-验证\test-author.mjs` —— **署名契约**（病：旧三路皆空而落默认，故初初调用署成「小鲸致小鲸」）
- `06-插件补丁\dsh-chronicle-验证\rule-drift-check.mjs` —— 口径副本对账

## 六、读日志之法之出处

`lib/materials.js` 之 `readEvents`／`listSessions` **借自** `dsh-chronicle/lib/replay.mjs`
（多帧 zstd 逐帧解；文件名有 `session.jsonl.zstd` 与 `session.v3.jsonl.zstd` 两代）。
那份读法已验过（34 档、54,564 事件）—— **借已验之器，不自造第二把未验的尺子**。
