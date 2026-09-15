# dsh-chronicle 📜

把 DSH 的会话事件流（event-sourced session）折叠成两份**实录**，注册为两个会话投影。

> 《明实录》给 DSH 的启示不是「皇帝—朝臣」那套形式，而是它作为一套
> **官方记忆 + 审计 + 知识编纂**的机制：编年、纪传、本末、凡例、差序、正副本。
> 编年那一层 DSH 本来就有（`dsh-session` 就是 event-sourced store）；
> 本插件补的是**纪传**与**本末**两层。

---

## 一、两个投影

| 投影键 | 体裁 | 记什么 | 上限 |
|---|---|---|---|
| `chronicleDossier` | **纪传体** | 这个会话碰过哪些**实体** —— `tool:` 工具、`file:` 文件、`dir:` 目录、`url:` 网址；各记首见/末见 seq、命中次数、证据 seq | 2000 实体 × 6 证据 |
| `chronicleNarrative` | **本末体** | 这个会话有哪几条**专题线** —— 每轮一事：意图、后续指令、步数、调用次数、用到的工具、触及的路径、结局 | 40 专题 × 24 列表项 + 累计总账 |

两者都是 **host-only**（不带 `wire`）：不上界面，只供宿主侧读取，因此本包没有 `client.js`。

### 折叠规则

```
chronicleDossier
  tool/call         → tool:<name>，并从 arguments 里提 file:/dir:<path>
  tool/result       → 从工具**输出**里提 file:/dir:<path> 与 url:<url>（只扫前 4000 字）
  user/message      → 仅 source.kind === 'user'（本人指令），提 url:<url>
  assistant/message → 提 url:<url>

chronicleNarrative
  turn/start  → 开一条线
  user/message（本人）→ 首条定意图（96 字内），其后计 followUps 并留摘要（最多 3 条）
  step/end    → 步数 +1
  tool/call   → 调用 +1，工具/路径去重入列；满了记 filesOmitted
  turn/end    → 结线，status = aborted | error | done
```

`chronicleNarrative` 另有一本 **`stats` 总账**（`turns` / `multiIntent` / `followUps` / `filesOmitted`），
只增不减 —— 因为 `topics` 只留最近 40 条，拿它核对全局必然对不上账。

---

## 二、怎么用

### 1. 挂载

本包声明了 `dsh.bundle.patch`，装进 profile 的 `node_modules` 后在
`~/.dsh/profiles/web/cordis.patch.yml` 里 insert 一行即可：

```yaml
- insert:
    - id: chronicle
      name: 'dsh-chronicle'
```

**挂载后必须重启 `dsh web`** —— 插件是 boot 时装载的，热改不生效。

### 2. 读

```js
// 宿主侧（别的插件 / 工具里）
const dossier = ctx.sessionProjections.stateOf(session, 'chronicleDossier');
const narrative = ctx.sessionProjections.stateOf(session, 'chronicleNarrative');
```

命令行走廊（不需要 DSH 在跑）：

```bash
node lib/replay.mjs                      # 列出全部会话日志
node lib/replay.mjs --last               # 回放最近一条
node lib/replay.mjs --session <id前缀>    # 回放指定会话
node lib/replay.mjs --all                # 回放全部
```

`replay.mjs` 用的是**同一份**折叠定义，直接读 `~/.dsh/sessions/**/session*.jsonl.zstd`
复算 —— 既能验折叠逻辑，也能随时查历史会话。

> ⚠️ 认文件名**别只认前缀**：日志格式已经换过一代，当前是 `session.v3.jsonl.zstd`
> （格式代号夹在中间）。早先按 `session.jsonl*` 匹配，整整一代会话一条都扫不到。

### 3. 落盘

投影状态由 `session-projection-cache` 按 `writeEveryEvents: 200` / `writeIntervalMs: 5000` 写进：

```
~/.dsh/storages/session_projcache/sessions/session-<id>.json
```

该 JSON 里应能看到 `chronicleDossier` 与 `chronicleNarrative` 两个键 ——
这是本插件**生效的直接证据**。

---

## 三、实现约束（照抄 `dsh-session-projection` 的契约）

1. **`apply` 必须是同步纯函数** —— 不碰 IO、不看时钟、不出随机。
2. **`state` 必须是 plain JSON** —— 持久化缓存的前提。
3. **不关心的事件返回同一引用** —— `Object.is` 相同则下游零工作。
4. **`stateVersion` 变了旧缓存作废** —— 改折叠语义或字段时务必递增。
   顺带一条实测结论：投影是**从持久化检查点续折**的，不是每次从零折，
   所以改了语义却不递增版本号，旧状态会被原样沿用 —— 症状是"改了没反应"。
5. 框架只用 `stateSchema.parse()`（`lib/index.js` 里 `def.stateSchema.parse(row.val)`）。

本包另有四条自己的规矩：

- **有界**：投影随事件无限长会吃内存，故设硬上限。但超限**不拒收新实体**，
  改为 LRU 腾位（旧策略实测丢了 2007 次新实体，等于越用越瞎）；
  淘汰数记在 `evicted`，连淘汰都救不下的记在 `dropped`。
- **截断留痕**：列表截断必须记数（`filesOmitted`），不许无声消失。
- **先解码再扫**：`tool/call` 的 `arguments` 是 JSON 字符串，Windows 路径写作
  `C:\\Users\\...`。直接正则会把转义反斜杠吃进实体 id，所以先 `JSON.parse`
  取真正的字符串值再扫（`argText()`）。
- **只认两种路径形状**：盘符路径，或真 UNC（`\\server\share`，server 名须以
  字母数字起头）。再加 `\\?\` 设备/超长路径单列一支。负向后顾
  `(?<![A-Za-z0-9])` 挡住 `https://x/y` 被从中间的 `p:` 起切成半截路径。

---

## 四、验证记录

### 2026-09-14（v1–v2 初版）

| 项 | 结果 |
|---|---|
| 语法检查（`node --check` ×3） | ✅ |
| 真实日志回放 | ✅ 6 条专题线全对 |
| 两份 state 过自己的 schema | ✅ |
| 历史路径原样保留（`C:\Users\<user>`） | ✅ 未被「修正」 |
| 修 bug：arguments 双反斜杠 | ✅ 路径恢复单反斜杠 |
| 修 bug：URL 被切成半截路径 | ✅ 文件实体 81 → 60，网址恢复完整 |

### 2026-09-14 晚（v4：全量自检后的六处修正）

拿本机 36 个会话、5.6 万事件、2700 次工具调用全量跑过，逐条修：

| # | 缺陷 | 修法 | 复检 |
|---|---|---|---|
| 1 | 同一路径多种写法各记一条（`C:\X` / `c:/X` / `C:\X\`） | `pathKey` 归一，显示留首次原样 | ✅ 重复桶 0 |
| 2 | 169/289「文件」其实是目录 | 扩展名白名单分级，新开 `dir` | ✅ 误判 0 |
| 3 | `tool/result` 一字未采 | 加扫输出前 4000 字 | ✅ 网址实体 0 → 344 |
| 4 | 一轮多条本人指令只留首条 | 其余计 `followUps` + 留摘要 | ✅ 见 `stats` |
| 5 | 列表上限 12 | 提到 24 | ✅ |
| 6 | 实体 300 封顶，`dropped = 2007` | 上限提至 1200，改 LRU | ✅ `dropped = 0` |

### 2026-09-14 深夜（v5：复检 v4 时又抓到的三处）

| # | 缺陷 | 根因 | 修法 | 复检 |
|---|---|---|---|---|
| 1 | 垃圾实体：`\\/g`、`\\Users\\<user>`、`\\Program` | 路径正则里挂着一条**单个反斜杠**的分支，任何带反斜杠的碎片都能自立门户 | 收网三次：先去掉单反斜杠分支；再要求 server 名像主机名；末了要求 server 名**以字母数字起头** | ✅ 22 → 0（不含自测文本本身的示例） |
| 2 | UNC 被压平 | `pathKey` 连开头的 `\\` 也收成一个 `\` | 先判定 UNC，再压平 | ✅ `\\server\share` ≠ `\server\share` |
| 3 | 列表截断无声 | 满了 24 条直接丢尾巴 | 每轮记 `filesOmitted` + `stats` 累计总账 | ✅ 累计 893 条不再是暗数 |

**复检口径本身也修了两处**（尺子错了会冤枉投影）：

- 早先几轮把 36 个会话**混成一个状态**折叠，turn 号在会话间撞车 ——
  改为**按会话分别折叠**（还原真实运行时语义，投影本来就是 per-session 的）。
- 独立对账脚本曾写 `ev.data.turn ?? 0`，可 `user/message` 事件里**根本没有
  `turn` 字段**（实测形状只有 `content`/`source`/`role`/`id`），161 条消息全倒进
  「第 0 轮」，于是对账差出 100 多条。改成从 `turn/start` 记轮号后：
  `multiIntent` 13 对 13、`followUps` 17 对 17。

**v5 全量结果**：36 会话 / 5.7 万事件 · `apply` 异常 0 · schema 不符 0 ·
实体合计 4433（单会话峰值 745 / 上限 2000）· `evicted` 0 · `dropped` 0 ·
结局分布 done 95 / error 11 / aborted 35 · 单元回归 29/29。

---

## 五、卸载

1. 从 `cordis.patch.yml` 删掉那条 `insert`（或整体注释掉）；
2. `rm -rf ~/.dsh/profiles/web/node_modules/dsh-chronicle`；
3. 重启 `dsh web`。

注册是 fiber 上的 effect，插件卸载即从投影快照与驱动中消失；
已落盘的 projcache 行会因 `stateVersion` / 键缺失而不被采用。
