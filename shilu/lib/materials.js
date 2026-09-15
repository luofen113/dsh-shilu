/**
 * 按日聚合会话事实 —— 「当日素材摘要」。
 *
 * **读日志之法借自** `dsh-chronicle/lib/replay.mjs`（多帧 zstd：每帧以魔数 28 b5 2f fd 起头，
 * 须逐帧解；文件名有 `session.jsonl.zstd` 与 `session.v3.jsonl.zstd` 两代，只认前缀会整代漏掉）。
 * 那份读法已验过（34 档、54,564 事件），此处**不自写第二份**。
 *
 * 本模块**不归类**：只把事实（谁说了什么、调了什么工具、触了哪些文件、成没成）摊平给人看，
 * 「诏令/章奏/决策」之分由执笔者作。
 *
 * @module dsh-shilu/materials
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const SESSIONS_ROOT = process.env.SHILU_SESSIONS ?? path.join(os.homedir(), '.dsh', 'sessions');
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const FILE_KEYS = ['file_path', 'path', 'filePath', 'notebook_path', 'cwd', 'target'];

/** 逐帧解一个多帧 zstd 文件；非 zstd 则按 JSONL 读。 */
export function readEvents(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf[0] !== MAGIC[0]) {
    return buf.toString('utf8').split('\n').filter((line) => line.trim() !== '');
  }
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offsets.push(i);
  }
  const out = [];
  for (let k = 0; k < offsets.length; k += 1) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
    let text;
    try { text = zlib.zstdDecompressSync(buf.subarray(offsets[k], end)).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) if (line.trim() !== '') out.push(line);
  }
  return out;
}

/** 扫描全部会话日志文件。 */
export function listSessions() {
  const found = [];
  if (!fs.existsSync(SESSIONS_ROOT)) return found;
  for (const workspace of fs.readdirSync(SESSIONS_ROOT)) {
    const wdir = path.join(SESSIONS_ROOT, workspace);
    if (!fs.statSync(wdir).isDirectory()) continue;
    for (const entry of fs.readdirSync(wdir)) {
      const sdir = path.join(wdir, entry);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const file of fs.readdirSync(sdir)) {
        if (!file.startsWith('session') || !file.includes('.jsonl')) continue;
        const full = path.join(sdir, file);
        found.push({ id: entry.replace(/^session-/, ''), workspace, file: full, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs });
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

const pad = (n) => String(n).padStart(2, '0');
/** 毫秒时间戳 → 本地日（YYYY-MM-DD）。 */
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 毫秒时间戳 → 本地时刻（HH:MM）。 */
export const hmOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** 日干支 —— 依凡例 calendar.day_formula（序号 = (JDN + 49) mod 60，甲子 = 0）。 */
export function ganzhiOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  const n = (jdn + 49) % 60;
  return GAN[n % 10] + ZHI[n % 12];
}

const cut = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 从消息体的 content 数组里取纯文本（只取 text 段，reasoning 只计数）。 */
function textsOf(content) {
  if (!Array.isArray(content)) return { text: '', reasoned: 0 };
  let text = '';
  let reasoned = 0;
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') text += part.text;
    else if (part?.type === 'reasoning') reasoned += String(part.text ?? '').length;
  }
  return { text, reasoned };
}

/** 从 tool/result 事件里取输出文本与成败。 */
function resultOf(event) {
  const parts = event.data?.message?.content ?? [];
  const part = Array.isArray(parts) ? parts[0] : undefined;
  const inner = part?.content ?? [];
  const text = (Array.isArray(inner) ? inner : []).map((c) => c?.text ?? '').join('\n');
  const failed = part?.isError === true || event.data?.isError === true || /^\s*(Error|error|\[exit code: (?!0))/m.test(text);
  return { text, failed };
}

/**
 * 聚一日之素材。
 * @param date - YYYY-MM-DD（本地日）。
 * @param opts - { maxChars, maxSessions }。
 * @returns 素材摘要（结构化 + 人可读文本）。
 */
export function buildMaterials(date, opts = {}) {
  const maxChars = opts.maxChars ?? 24000;
  const maxSessions = opts.maxSessions ?? 6;
  const sessions = [];
  let scanned = 0;
  for (const s of listSessions()) {
    scanned += 1;
    let events;
    try { events = readEvents(s.file).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { continue; }
    const head = events.find((e) => e.type === 'session') ?? {};
    const onDay = events.filter((e) => typeof e.time === 'number' && dayOf(e.time) === date);
    if (onDay.length === 0) continue;
    const lines = [];
    const files = new Set();
    let toolCalls = 0;
    let failures = 0;
    let userTurns = 0;
    for (const e of onDay) {
      const t = hmOf(e.time);
      if (e.type === 'turn/start') lines.push(`  [${t}] ⏵ 轮 ${e.data?.turn}`);
      else if (e.type === 'turn/end') lines.push(`  [${t}] ⏹ 轮 ${e.data?.turn} 终：${e.data?.reason?.kind ?? '?'}`);
      else if (e.type === 'user/message') {
        const { text } = textsOf(e.data?.content);
        const from = e.data?.source?.kind;
        if (from === 'plugin') lines.push(`  [${t}] （系统）${cut(text, 160)}`);
        else { userTurns += 1; lines.push(`  [${t}] 主上：${cut(text, 300)}`); }
      } else if (e.type === 'assistant/message') {
        const { text } = textsOf(e.data?.message?.content);
        if (text.trim()) lines.push(`  [${t}] 鲸：${cut(text, 220)}`);
      } else if (e.type === 'tool/call') {
        toolCalls += 1;
        let brief = '';
        try {
          const args = JSON.parse(e.data?.arguments ?? '{}');
          for (const k of FILE_KEYS) if (typeof args[k] === 'string') files.add(args[k]);
          brief = cut(args.command ?? args.pattern ?? args.file_path ?? args.path ?? args.query ?? Object.keys(args).join(','), 140);
        } catch { brief = cut(e.data?.arguments, 140); }
        lines.push(`  [${t}] ✦ ${e.data?.name}: ${brief}`);
      } else if (e.type === 'tool/result') {
        const { text, failed } = resultOf(e);
        if (failed) { failures += 1; lines.push(`  [${t}]   ↳ ✗ ${cut(text, 200)}`); }
      } else if (e.type === 'compaction/start') lines.push(`  [${t}] ⇩ 压缩开始（轮 ${e.data?.turn}）`);
      else if (e.type === 'subagent') lines.push(`  [${t}] ⚙ 派生子代理`);
    }
    const times = onDay.map((e) => e.time).sort((a, b) => a - b);
    sessions.push({
      id: s.id, workspace: s.workspace, preset: head.agentPreset ?? '?', cwd: head.cwd ?? '?',
      depth: head.delegationDepth ?? 0, seeded: head.isSeeded === true,
      events: onDay.length, toolCalls, failures, userTurns,
      from: hmOf(times[0]), to: hmOf(times[times.length - 1]),
      files: [...files].slice(0, 40), lines,
    });
  }
  sessions.sort((a, b) => (a.from < b.from ? -1 : 1));
  const head = [
    `# 当日素材 · ${date}（${ganzhiOf(date)}）`,
    '',
    `会话 ${sessions.length} 条（扫过 ${scanned} 档）｜ 事件 ${sessions.reduce((n, s) => n + s.events, 0)} ｜ 工具调用 ${sessions.reduce((n, s) => n + s.toolCalls, 0)} ｜ 报错 ${sessions.reduce((n, s) => n + s.failures, 0)}`,
    '',
    '> 此**只是素材**：事实摊平，未加归类。归类与轻重是执笔者的活。',
    '',
  ];
  const body = [];
  for (const s of sessions.slice(0, maxSessions)) {
    body.push(`## 会话 ${s.id.slice(0, 8)} · 预设 ${s.preset} · ${s.from}–${s.to}`);
    body.push(`cwd: ${s.cwd}${s.depth > 0 ? ` ｜ 子代理（深度 ${s.depth}）` : ''}${s.seeded ? ' ｜ 种子会话' : ''}`);
    body.push(`事件 ${s.events} ｜ 工具 ${s.toolCalls} ｜ 报错 ${s.failures} ｜ 主上发言 ${s.userTurns}`);
    if (s.files.length) body.push(`触及：${s.files.join(' · ')}`);
    body.push(...s.lines);
    body.push('');
  }
  if (sessions.length > maxSessions) body.push(`（另有 ${sessions.length - maxSessions} 条会话未展开 —— 会话过多，宜窄其日或分次取）`, '');
  let text = head.concat(body).join('\n');
  let truncated = false;
  if (text.length > maxChars) { text = `${text.slice(0, maxChars)}\n\n（已截断：素材共 ${text.length} 字，上限 ${maxChars}）`; truncated = true; }
  return {
    date,
    ganzhi: ganzhiOf(date),
    sessions: sessions.length,
    events: sessions.reduce((n, s) => n + s.events, 0),
    toolCalls: sessions.reduce((n, s) => n + s.toolCalls, 0),
    failures: sessions.reduce((n, s) => n + s.failures, 0),
    chars: text.length,
    truncated,
    text,
  };
}
