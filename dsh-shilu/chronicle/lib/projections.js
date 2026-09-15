/**
 * ============================================================================
 * dsh-chronicle · 两个会话投影（宿主半侧，纯折叠）· v5
 * ============================================================================
 *
 * 【是什么】
 *   把 DSH 的会话事件流（event-sourced session）折叠成两份"实录"：
 *
 *   1. `chronicleDossier`   —— 纪传体：这个会话碰过哪些实体
 *                              （工具 / 文件 / 目录 / 网址），各见于第几号事件。
 *   2. `chronicleNarrative` —— 本末体：这个会话有哪几条"专题线"
 *                              （每轮一事：意图、步数、调用、触及的文件、结局）。
 *
 * 【为什么这么写】
 *   session-projection 的契约要求（见 @deepseek-ai/dsh-session-projection）：
 *     - `apply` 必须是**同步纯函数** —— 不碰 IO、不看时钟、不出随机；
 *     - `state` 必须是 **plain JSON**（持久化缓存的前提）；
 *     - 不关心的事件**返回同一引用**（`Object.is` 相同 → 下游零工作）；
 *     - `stateVersion` 变则旧缓存作废（改折叠语义务必递增）。
 *   所以下面每个分支要么 `return state`（原引用），要么返回新对象。
 *
 * 【v4 修了什么】
 *   拿本机 36 个会话、56505 事件、2698 次工具调用跑过一遍后，逐条修：
 *     1. **路径归一**：`C:\X`、`c:/X`、`C:\X\` 曾记成三条 —— 今归一到一个 key，
 *        显示仍留**首次出现的原样**（不篡改所见）。
 *     2. **目录与文件分开**：按已知扩展名白名单判 `file` / `dir`
 *        （`…\n.e.k.o` 是目录，简单"有点就算文件"的规则会栽在这上面）。
 *     3. **`tool/result` 也采**：工具**输出**里的路径同样是"碰过"的证据；
 *        只扫前若干字符，免得把整份文件内容拖进来。
 *     4. **每轮的后续指令不再丢**：首条入 `intent`，其余计 `followUps` 并留摘要。
 *     5. **列表上限 12 → 24**。
 *     6. **上限 300 → 1200，且由"拒绝新实体"改为 LRU 淘汰** —— 旧策略在实机上
 *        丢了 2007 次新实体，等于越用越瞎；今改为腾位给新，并分别记
 *        `evicted`（淘汰数）与 `dropped`（连淘汰都救不下的次数）。
 *
 * 【v5 修了什么】
 *   复检 v4 时又抓到三处 —— 都是"以为修好了、其实没修净"的：
 *     1. **垃圾实体**：正则里曾挂着一条**单个反斜杠**的分支，于是源码片段
 *        `/\\/g`、二次转写的 `\\Users\\<user>`、`\\Program` 这类碎片都被当成
 *        路径收进了档案。今只认两种形状：**盘符路径**与**真 UNC**
 *        （`\\server\share`，且 server 名不许为空、不许以斜杠起头）。
 *     2. **UNC 被压平**：`pathKey` 连开头的 `\\` 也收成一个 `\`，于是
 *        `\\server\share` 与 `\server\share` 混为一谈。今保住 UNC 前缀。
 *     3. **截断无声**：`files` 一满 24 条就悄悄丢尾巴（实测 4 轮撞顶）。
 *        今每轮记 `filesOmitted`，并在 `stats` 里留**累计总账** —— 因为
 *        `topics` 只留最近 40 条，拿它去核对全局，必然对不上账。
 *
 * 【有界】
 *   投影随事件无限增长会吃内存，故均有硬上限。超限时**淘汰命中最低、最久未见
 *   的** —— 宁可少记，不可撑爆，也不可只留旧的不纳新的。
 *
 * 【host-only】
 *   两个单元都不带 `wire` —— 没有浏览器半侧视图，只供宿主侧读取
 *   （`ctx.sessionProjections.stateOf(session, key)`）。故本包无 client.js。
 *
 * @module dsh-chronicle/projections
 */
import { z } from 'zod';

// ── 上限 ─────────────────────────────────────────────────────────────────────
/** 实体总数上限（超出则 LRU 淘汰）。 */
const MAX_ENTITIES = 2000;
/** 一次淘汰的批量（避免每来一个新实体就全表排序）。 */
const EVICT_BATCH = 200;
/** 单个实体保留的证据（事件 seq）条数上限。 */
const MAX_EVIDENCE = 6;
/** 专题线保留条数上限（超出丢最旧）。 */
const MAX_TOPICS = 40;
/** 单条专题里的工具 / 文件列表长度上限。 */
const MAX_LIST = 24;
/** 意图摘要字数上限。 */
const INTENT_CHARS = 96;
/** 每轮保留的后续指令摘要条数上限。 */
const MAX_FOLLOW_UPS = 3;
/** `tool/result` 每个结果最多扫描的字符数（结果里常有整份文件内容）。 */
const RESULT_SCAN = 4000;

// ── 抽取用正则（模块级 + 手动重置 lastIndex，保证纯函数语义）──────────────
/**
 * 路径形状：**盘符路径**或**真 UNC**，二者必居其一。
 *
 * 1. **负向后顾** `(?<![A-Za-z0-9])` —— 挡住 `https://api.x/y`（不然会被从中间
 *    的 `p:` 起切成 `p://api.x/y` 这种半截路径）。
 * 2. **盘符后不许再跟斜杠** `[A-Za-z]:[\\/](?![\\/])` —— 真正的盘符路径是
 *    `C:\Users`、`C:/Users`；而 `p://x` 这种双正斜杠是**协议**的样子。
 *    注意只排**双正斜杠**，不排双反斜杠：命令参数里的 `C:\\Users` 是转写写法，
 *    那是真实数据，要留。
 * 3. **UNC 的 server 名要像主机名** `\\\\[A-Za-z0-9][A-Za-z0-9_.-]*\\[^\s\\/]` ——
 *    这条是 v5 补上的关键约束，收了三网才收干净：
 *      · 旧版把"两个反斜杠"与"一个反斜杠"拆成两条分支，于是任何带反斜杠的
 *        碎片都能自立门户：源码里的 `/\\/g`（正则字面量）、二次转写的
 *        `\\Users\\<user>`（本该是 `C:\Users\<user>`）、`\\Program`，全成了档案
 *        里的"路径"。
 *      · 只要求"非斜杠非空白"仍不够 —— PowerShell 正则片段 `\\(node_modules|\.git`
 *        照样混进来。
 *      · 再把 server 名限成主机名字符，`\\.\.\.\\CurrentVersion` 还能钻进来
 *        （点也在主机名字符集里）。**末了要求 server 名以字母或数字起头**，
 *        碎片才全部落选：`\\Users\\<user>` 卡在 share 首字符是 `\`，
 *        `\\.\.\.\\` 与 `\\.\.\` 卡在 server 首字符是 `.`。
 * 4. **`\\?\` 单独放行** —— Windows 超长路径与设备接口路径
 *    （`\\?\usb#vid_…`）是**真实数据**，server 名为 `?` 过不了上一条，
 *    故单列一支，别把真家伙一起误杀。
 */
const RE_PATH = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/](?![\\/])|\\\\\?[\\/]|\\\\[A-Za-z0-9][A-Za-z0-9_.-]*\\[^\s\\/]|(?<!:)\/\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[^\s\\/])[^\s"'`|<>*?,;)\]}]+/g;
/** http(s) 网址。 */
const RE_URL = /https?:\/\/[^\s"'`<>)\]},]+/g;
/** 连续空白（摘要时压平）。 */
const RE_WS = /\s+/g;
/**
 * 已知的**文件**扩展名白名单 —— 不在其中的按**目录**记。
 *
 * 为什么用白名单而不是"有点就是文件"：`F:\…\n.e.k.o` 是个**目录**，可它末尾
 * 的 `.o` 会被简单规则误判成文件。白名单把这类误判挡在门外。
 */
const RE_FILE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx|json|jsonl|yml|yaml|md|txt|ps1|psm1|bat|cmd|sh|py|lua|css|html|htm|xml|toml|ini|cfg|conf|log|db|sqlite|csv|tsv|map|lock|vue|svelte|exe|dll|sys|png|jpg|jpeg|gif|webp|svg|ico|zip|gz|zst|zstd|tar|7z|rar|pdf|docx|xlsx|pptx|wasm|node)$/i;

// ── 小工具 ───────────────────────────────────────────────────────────────────

/**
 * 拼接消息内容里的**文本块**（忽略 reasoning / tool-call / tool-result）。
 * @param content - 消息的 content 数组。
 * @returns 以空格相连的正文。
 */
export function textOf(content) {
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      out += out === '' ? block.text : ` ${block.text}`;
    }
  }
  return out;
}

/**
 * 压平空白并截断成一行摘要。
 * @param text - 原文。
 * @param limit - 字数上限。
 * @returns 摘要（截断时末尾加省略号）。
 */
export function preview(text, limit) {
  const flat = String(text ?? '').replace(RE_WS, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * 取出一段 JSON 里所有的字符串值。
 *
 * 工具参数（`tool/call` 的 `arguments`）是**一个 JSON 字符串**，里面 Windows
 * 路径写作 `C:\\Users\\<user>`。若直接对这个字符串跑路径正则，会把转义的
 * 双反斜杠一起吃进实体 id，既难看又破坏去重。所以先解码成对象，再取出真正
 * 的字符串值来扫。
 *
 * @param value - 已解析的 JSON 值。
 * @param depth - 递归深度（防御性上限）。
 * @returns 字符串值列表。
 */
function stringsOf(value, depth = 0) {
  if (depth > 6) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsOf(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item) => stringsOf(item, depth + 1));
  }
  return [];
}

/**
 * 把 tool/call 的原始参数摊成可扫描的文本。
 * @param raw - `event.data.arguments`（JSON 字符串）。
 * @returns 解码后的文本；解析失败则原样返回。
 */
export function argText(raw) {
  if (typeof raw !== 'string' || raw === '') return '';
  try {
    return stringsOf(JSON.parse(raw)).join('\n');
  } catch {
    return raw;
  }
}

/**
 * 把 tool/result 的内容摊成可扫描的文本（**限量**取，输出可能极大）。
 * @param content - `tool-result` 块的 content 数组。
 * @returns 截断后的文本。
 */
export function resultText(content) {
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') {
      out += out === '' ? block.text : `\n${block.text}`;
      if (out.length >= RESULT_SCAN) break;
    }
  }
  return out.length > RESULT_SCAN ? out.slice(0, RESULT_SCAN) : out;
}

/**
 * 视觉归一：把同一个路径的各种写法收成一个 key。
 *
 * Windows 路径大小写不敏感，`\` 与 `/` 混用、末尾多一个斜杠、转义写法
 * （`C:\\Users`）都指向同一处。不归一的话，同一份文件会在档案里开出好几条
 * 分身（实测：`C:\Users\<user>` 一共记了 3 条）。
 *
 * @param id - 原样路径。
 * @returns 归一化后的比较键。
 */
export function pathKey(id) {
  // UNC 前缀（`\\server\share`）与"从根算起"（`\Users`）不是一回事：
  // 先判定，再压平，免得两者混成一条。
  const unc = id.startsWith('\\\\') || id.startsWith('//');
  let s = id.replace(/\\\\/g, '\\').replace(/\//g, '\\').replace(/\\+$/, '');
  if (unc) s = `\\\\${s.replace(/^\\+/, '')}`;
  else if (s === '') s = '\\';
  return s.toLowerCase();
}

/**
 * 判断一个路径该记作 `file` 还是 `dir`。
 * @param id - 原样路径。
 * @returns `'file'` 或 `'dir'`。
 */
export function kindOfPath(id) {
  const base = id.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return RE_FILE_EXT.test(base) ? 'file' : 'dir';
}

/**
 * 从任意文本里提取**路径**（至多 MAX_LIST 条，未归一）。
 * @param text - 待扫描文本。
 * @returns 路径列表。
 */
export function pathsIn(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = [];
  RE_PATH.lastIndex = 0;
  let match = RE_PATH.exec(text);
  while (match !== null) {
    const path = match[0].replace(/[\\/]+$/, '').replace(/[.,;:]+$/, '');
    if (path.length > 3 && path.length <= 260) found.push(path);
    if (found.length >= MAX_LIST) break;
    match = RE_PATH.exec(text);
  }
  return found;
}

/**
 * 从文本里提取网址（去掉 query / hash，只留 origin + pathname）。
 * @param text - 待扫描文本。
 * @returns 网址列表（至多 MAX_LIST 条）。
 */
export function urlsIn(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = [];
  RE_URL.lastIndex = 0;
  let match = RE_URL.exec(text);
  while (match !== null) {
    let url = match[0].replace(/[.,;:]+$/, '');
    try {
      const parsed = new URL(url);
      url = `${parsed.origin}${parsed.pathname}`;
    } catch {
      // 不是合法 URL：保留原样的裁剪结果。
    }
    if (url.length <= 200) found.push(url);
    if (found.length >= MAX_LIST) break;
    match = RE_URL.exec(text);
  }
  return found;
}

// ════════════════════════════════════════════════════════════════════════════
// 一、chronicleDossier —— 纪传体：实体档案
// ════════════════════════════════════════════════════════════════════════════

/** 一个实体：什么、第几号事件首见 / 末见、见了几回、证据 seq。 */
const entitySchema = z.object({
  /** `tool` / `file` / `dir` / `url`。 */
  kind: z.string(),
  /** 首次出现时的原样写法（显示用，不篡改）。 */
  id: z.string(),
  firstSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  hits: z.number().int().positive(),
  evidence: z.array(z.number().int().nonnegative()),
}).strict();

const dossierStateSchema = z.object({
  /** 归一键 → 实体。 */
  entities: z.record(z.string(), entitySchema),
  /** 首见顺序（也用于判上限）。 */
  order: z.array(z.string()),
  /** 被 LRU 淘汰掉的实体数。 */
  evicted: z.number().int().nonnegative(),
  /** 因超上限而未记的次数。 */
  dropped: z.number().int().nonnegative(),
}).strict();

const EMPTY_DOSSIER = { entities: {}, order: [], evicted: 0, dropped: 0 };

/**
 * 造一个实体的归一键。
 * @param kind - 实体种类。
 * @param id - 原样标识。
 * @returns `kind|归一键`。
 */
function keyOf(kind, id) {
  if (kind === 'url') return `url|${id.replace(/\/+$/, '').toLowerCase()}`;
  if (kind === 'tool') return `tool|${id}`;
  return `${kind}|${pathKey(id)}`;
}

/**
 * LRU 淘汰：腾出 EVICT_BATCH 个位置，优先淘汰**命中最低、最久未见**的。
 * @param state - 当前档案状态。
 * @returns 淘汰后的新状态。
 */
function evict(state) {
  const ranked = state.order.slice().sort((a, b) => {
    const ea = state.entities[a];
    const eb = state.entities[b];
    if (ea === undefined || eb === undefined) return 0;
    const byHits = ea.hits - eb.hits;
    return byHits !== 0 ? byHits : ea.lastSeq - eb.lastSeq;
  });
  const doomed = new Set(ranked.slice(0, EVICT_BATCH));
  const entities = {};
  for (const [k, v] of Object.entries(state.entities)) if (!doomed.has(k)) entities[k] = v;
  return {
    entities,
    order: state.order.filter((k) => !doomed.has(k)),
    evicted: state.evicted + doomed.size,
    dropped: state.dropped,
  };
}

/**
 * 记一个实体的一次出现（纯函数：总是返回新状态，除非状态未变）。
 * @param state - 当前档案状态。
 * @param kind - 实体种类（tool / file / dir / url）。
 * @param id - 实体标识（原样）。
 * @param seq - 本次出现的事件 seq。
 * @returns 下一个状态。
 */
function touch(state, kind, id, seq) {
  if (typeof id !== 'string' || id === '') return state;
  const key = keyOf(kind, id);
  const previous = state.entities[key];
  if (previous !== undefined) {
    const evidence = previous.evidence.length >= MAX_EVIDENCE
      ? previous.evidence
      : [...previous.evidence, seq];
    return {
      entities: { ...state.entities, [key]: { ...previous, lastSeq: seq, hits: previous.hits + 1, evidence } },
      order: state.order,
      evicted: state.evicted,
      dropped: state.dropped,
    };
  }
  // 满了：先淘汰一批再收新的（v3 之前是"满了就拒收"，实机丢了 2007 次）。
  const base = state.order.length >= MAX_ENTITIES ? evict(state) : state;
  return {
    entities: { ...base.entities, [key]: { kind, id, firstSeq: seq, lastSeq: seq, hits: 1, evidence: [seq] } },
    order: [...base.order, key],
    evicted: base.evicted,
    dropped: base.dropped,
  };
}

/**
 * 把一批提取出的标识记入档案。
 * @param state - 当前状态。
 * @param kind - 实体种类。
 * @param ids - 标识列表。
 * @param seq - 事件 seq。
 * @returns 下一个状态。
 */
function touchAll(state, kind, ids, seq) {
  let next = state;
  for (const id of ids) next = touch(next, kind, id, seq);
  return next;
}

/**
 * 纪传体折叠：认四类事件。
 *   - `tool/call`         → tool（工具名）+ file/dir（arguments 里的路径）
 *   - `tool/result`       → file/dir（输出里的路径）+ url
 *   - `user/message`（本人）→ url（正文里的网址）
 *   - `assistant/message` → url
 * @param state - 当前状态。
 * @param event - 一条已提交的会话事件。
 * @returns 下一个状态（不关心则原引用）。
 */
export function applyDossier(state, event) {
  const seq = event.seq;
  if (event.type === 'tool/call') {
    const data = event.data ?? {};
    let next = touch(state, 'tool', data.name, seq);
    for (const path of pathsIn(argText(data.arguments))) next = touch(next, kindOfPath(path), path, seq);
    return next;
  }
  if (event.type === 'tool/result') {
    const blocks = event.data?.message?.content;
    if (!Array.isArray(blocks)) return state;
    let next = state;
    for (const block of blocks) {
      if (block?.type !== 'tool-result') continue;
      const text = resultText(block.content);
      if (text === '') continue;
      for (const path of pathsIn(text)) next = touch(next, kindOfPath(path), path, seq);
      for (const url of urlsIn(text)) next = touch(next, 'url', url, seq);
    }
    return next;
  }
  if (event.type === 'user/message') {
    // 只记「本人」说的话；插件注入的通知（source.kind === 'plugin'）不算用户意图。
    if (event.data?.source?.kind !== 'user') return state;
    return touchAll(state, 'url', urlsIn(textOf(event.data.content)), seq);
  }
  if (event.type === 'assistant/message') {
    return touchAll(state, 'url', urlsIn(textOf(event.data?.message?.content)), seq);
  }
  return state;
}

/**
 * 构建 `chronicleDossier` 投影单元（host-only）。
 * @returns 投影定义，注册到 `ctx.sessionProjections`。
 */
export function createChronicleDossierProjection() {
  return {
    key: 'chronicleDossier',
    stateVersion: 5,
    stateSchema: dossierStateSchema,
    init: () => EMPTY_DOSSIER,
    apply: applyDossier,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 二、chronicleNarrative —— 本末体：专题线
// ════════════════════════════════════════════════════════════════════════════

/** 一条进行中的专题线。 */
const draftSchema = z.object({
  turn: z.number().int().nonnegative(),
  startSeq: z.number().int().nonnegative(),
  /** 首条本人指令的摘要。 */
  intent: z.string(),
  /** 后续本人指令（含 steer 插话）的条数。 */
  followUps: z.number().int().nonnegative(),
  /** 后续指令的摘要（最多 MAX_FOLLOW_UPS 条）。 */
  notes: z.array(z.string()),
  steps: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  tools: z.array(z.string()),
  files: z.array(z.string()),
  /** 因列表已满而**没能记进** `files` 的路径条数（截断必须留痕，不许无声）。 */
  filesOmitted: z.number().int().nonnegative(),
}).strict();

/** 一条已了结的专题线。 */
const topicSchema = draftSchema.extend({
  endSeq: z.number().int().nonnegative(),
  status: z.enum(['done', 'aborted', 'error']),
}).strict();

const narrativeStateSchema = z.object({
  topics: z.array(topicSchema),
  draft: draftSchema.nullable(),
  /**
   * 累计总账。`topics` 只留最近 MAX_TOPICS 条，**光看它无法核对全局** ——
   * 实测：本机 19 个「多指令轮」里，能从 topics 里看见的只有 1 个。
   * 所以另立一本账，只增不减。
   */
  stats: z.object({
    /** 已了结的轮次总数。 */
    turns: z.number().int().nonnegative(),
    /** 其中「同一轮收到多条本人指令」的轮次数。 */
    multiIntent: z.number().int().nonnegative(),
    /** 后续指令（含 steer 插话）的总条数。 */
    followUps: z.number().int().nonnegative(),
    /** 因列表满而未记的路径总条数。 */
    filesOmitted: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const EMPTY_STATS = { turns: 0, multiIntent: 0, followUps: 0, filesOmitted: 0 };
const EMPTY_NARRATIVE = { topics: [], draft: null, stats: EMPTY_STATS };

/**
 * 往列表里加一项（去重 + 限长）。
 * @param list - 当前列表。
 * @param value - 待加值。
 * @param max - 上限。
 * @returns 原列表或新列表。
 */
function pushUnique(list, value, max) {
  if (typeof value !== 'string' || value === '') return list;
  if (list.includes(value) || list.length >= max) return list;
  return [...list, value];
}

/**
 * 本末体折叠：以 `turn` 为一条专题线的边界。
 *   `turn/start` 开线 → `user/message` 定意图（后续者计 followUps）→
 *   `step/end` 计步 → `tool/call` 计调用与触及文件 → `turn/end` 结线定结局。
 * @param state - 当前状态。
 * @param event - 一条已提交的会话事件。
 * @returns 下一个状态（不关心则原引用）。
 */
export function applyNarrative(state, event) {
  const data = event.data ?? {};
  const seq = event.seq;
  const stats = state.stats;
  switch (event.type) {
    case 'turn/start': {
      // 幂等：同一 turn 重复 start 不重开线。
      if (state.draft !== null && state.draft.turn === data.turn) return state;
      return {
        topics: state.topics,
        draft: { turn: data.turn, startSeq: seq, intent: '', followUps: 0, notes: [], steps: 0, calls: 0, tools: [], files: [], filesOmitted: 0 },
        stats,
      };
    }
    case 'user/message': {
      const draft = state.draft;
      if (draft === null) return state;
      if (data.source?.kind !== 'user') return state;
      const summary = preview(textOf(data.content), INTENT_CHARS);
      if (summary === '') return state;
      if (draft.intent === '') return { topics: state.topics, draft: { ...draft, intent: summary }, stats };
      // 后续指令（含 steer 插话）：不再被丢弃，计条数并留摘要。
      const notes = draft.notes.length >= MAX_FOLLOW_UPS ? draft.notes : [...draft.notes, summary];
      return {
        topics: state.topics,
        draft: { ...draft, followUps: draft.followUps + 1, notes },
        // 0 → 1 的那一刻，这一轮才算"多指令轮"。
        stats: {
          ...stats,
          followUps: stats.followUps + 1,
          multiIntent: stats.multiIntent + (draft.followUps === 0 ? 1 : 0),
        },
      };
    }
    case 'step/end': {
      const draft = state.draft;
      if (draft === null) return state;
      return { topics: state.topics, draft: { ...draft, steps: draft.steps + 1 }, stats };
    }
    case 'tool/call': {
      const draft = state.draft;
      if (draft === null) return state;
      let files = draft.files;
      let omitted = draft.filesOmitted;
      for (const path of pathsIn(argText(data.arguments))) {
        const next = pushUnique(files, path, MAX_LIST);
        // 列表没长（既不是重复、也不是空串）＝ 撞了上限，记一笔，别让它无声消失。
        if (next === files && path !== '' && !files.includes(path)) omitted += 1;
        files = next;
      }
      return {
        topics: state.topics,
        draft: {
          ...draft,
          calls: draft.calls + 1,
          tools: pushUnique(draft.tools, data.name, MAX_LIST),
          files,
          filesOmitted: omitted,
        },
        stats,
      };
    }
    case 'turn/end': {
      const draft = state.draft;
      if (draft === null) return state;
      const kind = data.reason?.kind;
      const status = kind === 'aborted' ? 'aborted' : kind === 'error' ? 'error' : 'done';
      const topic = { ...draft, endSeq: seq, status };
      const topics = state.topics.length >= MAX_TOPICS
        ? [...state.topics.slice(1), topic]
        : [...state.topics, topic];
      return {
        topics,
        draft: null,
        stats: { ...stats, turns: stats.turns + 1, filesOmitted: stats.filesOmitted + draft.filesOmitted },
      };
    }
    default: return state;
  }
}

/**
 * 构建 `chronicleNarrative` 投影单元（host-only）。
 * @returns 投影定义，注册到 `ctx.sessionProjections`。
 */
export function createChronicleNarrativeProjection() {
  return {
    key: 'chronicleNarrative',
    stateVersion: 5,
    stateSchema: narrativeStateSchema,
    init: () => EMPTY_NARRATIVE,
    apply: applyNarrative,
  };
}
