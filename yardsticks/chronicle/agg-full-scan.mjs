/**
 * ============================================================================
 * dsh-chronicle · 全量独立复算（第二把尺子）
 * ============================================================================
 *
 * 【用途】
 *   把本机 `~/.dsh/sessions/**` 全部会话日志（多帧 zstd，逐帧解）**按会话分别**
 *   折叠一遍 chronicle 两份投影，出一本总账 —— 用来在**不依赖 DSH 进程**的前提下，
 *   独立复核投影的行为与投影缓存是否对得上。
 *
 *   ⚠️ 投影是 per-session 之物，**必须按会话分别折叠**：混折会让 turn 号在会话间
 *      撞车（此坑本工作区记过，见《DSH实录》戒慎第十一条）。
 *
 * 【用法】
 *   node agg-full-scan.mjs                     # 用 profile 里已部署的那份折叠定义
 *   node agg-full-scan.mjs <projections.js>    # 指定另一份（例如工作区源码）对照
 *
 * 【与 test-v5.mjs 的分工】
 *   test-v5.mjs  —— 单元回归：验「形」（路径正则、归一、分级），29 项。
 *   本脚本       —— 全量复算：验「账」（实体/专题/结局/总账），38 会话。
 *   两者与 replay.mjs 共用同一份折叠定义，但**统计口径各自独立写**，
 *   免犯「校验脚本与被测代码共用同一批对象」之误（戒慎第八条）。
 *
 * 【注意】须在能解析 `zod` 的目录下跑（如
 *   `~/.dsh/profiles/web/node_modules/dsh-chronicle`），否则 import 失败。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const target = process.argv[2]
  ?? path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-chronicle', 'lib', 'projections.js');
const { createChronicleDossierProjection, createChronicleNarrativeProjection } = await import(new URL(`file://${target.replace(/\\/g, '/')}`).href);

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const root = path.join(os.homedir(), '.dsh', 'sessions');

/** 逐帧解多帧 zstd（只解第一帧会只得一行抬头 —— 戒慎第七条）。 */
function readEvents(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf[0] !== MAGIC[0]) return buf.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  const offs = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offs.push(i);
  }
  const out = [];
  for (let k = 0; k < offs.length; k += 1) {
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    let text;
    try { text = zlib.zstdDecompressSync(buf.subarray(offs[k], end)).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) if (line.trim() !== '') out.push(line);
  }
  return out;
}

/** 认日志**不可只认前缀**：当前格式是 `session.v3.jsonl.zstd`（代号码夹在中间）。 */
function listSessions() {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const ws of fs.readdirSync(root)) {
    const wdir = path.join(root, ws);
    if (!fs.statSync(wdir).isDirectory()) continue;
    for (const entry of fs.readdirSync(wdir)) {
      const sdir = path.join(wdir, entry);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const f of fs.readdirSync(sdir)) {
        if (f.startsWith('session') && f.includes('.jsonl')) files.push({ id: entry.replace(/^session-/, ''), file: path.join(sdir, f) });
      }
    }
  }
  return files;
}

const files = listSessions();
const dDef = createChronicleDossierProjection();
const nDef = createChronicleNarrativeProjection();

const agg = {
  sessions: 0, events: 0, applyErrors: 0, schemaErrors: 0,
  kinds: { tool: 0, file: 0, dir: 0, url: 0 }, entities: 0,
  peakEnt: 0, peakId: '', evicted: 0, dropped: 0,
  status: {}, topicRows: 0,
  turns: 0, multiIntent: 0, followUps: 0, filesOmitted: 0,
  noStats: [],
};
const raw = { turns: 0, toolCalls: 0, userMsgs: 0 };

for (const s of files) {
  const lines = readEvents(s.file);
  const evs = [];
  let d = dDef.init();
  let n = nDef.init();
  let bad = 0;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    evs.push(e);
    raw.turns += e.type === 'turn/start' ? 1 : 0;
    raw.toolCalls += e.type === 'tool/call' ? 1 : 0;
    raw.userMsgs += (e.type === 'user/message' && e.data?.source?.kind === 'user') ? 1 : 0;
    try { d = dDef.apply(d, e); n = nDef.apply(n, e); } catch { bad += 1; }
  }
  agg.sessions += 1;
  agg.events += evs.length;
  agg.applyErrors += bad;
  try { dDef.stateSchema.parse(d); nDef.stateSchema.parse(n); } catch { agg.schemaErrors += 1; }
  const ids = Object.values(d.entities);
  for (const e of ids) agg.kinds[e.kind] = (agg.kinds[e.kind] ?? 0) + 1;
  agg.entities += ids.length;
  agg.evicted += d.evicted ?? 0;
  agg.dropped += d.dropped ?? 0;
  if (ids.length > agg.peakEnt) { agg.peakEnt = ids.length; agg.peakId = s.id.slice(0, 8); }
  for (const t of n.topics) { agg.topicRows += 1; agg.status[t.status] = (agg.status[t.status] ?? 0) + 1; }
  if (n.draft) agg.status.draft = (agg.status.draft ?? 0) + 1;
  if (n.stats) {
    agg.turns += n.stats.turns ?? 0;
    agg.multiIntent += n.stats.multiIntent ?? 0;
    agg.followUps += n.stats.followUps ?? 0;
    agg.filesOmitted += n.stats.filesOmitted ?? 0;
  } else {
    agg.noStats.push(s.id.slice(0, 8));
  }
}

console.log('定义来自: ' + target);
console.log(JSON.stringify({ agg, raw, files: files.length }, null, 2));

// 对账：原生 turn/start 应 = 已了结轮数 + 进行中轮数
const settled = Object.entries(agg.status).filter(([k]) => k !== 'draft').reduce((a, [, v]) => a + v, 0);
if (raw.turns !== settled + (agg.status.draft ?? 0)) {
  console.log(`\n❌ 对账不符：turn/start ${raw.turns} ≠ 了结 ${settled} + 进行中 ${agg.status.draft ?? 0}`);
  process.exit(1);
}
if (agg.turns !== settled) {
  console.log(`\n❌ 对账不符：stats.turns ${agg.turns} ≠ 专题行合计（不含进行中）${settled}`);
  process.exit(1);
}
console.log(`\n✅ 对账相符：turn/start ${raw.turns} = 已了结 ${settled} + 进行中 ${agg.status.draft ?? 0}；stats.turns 与专题行一致`);
