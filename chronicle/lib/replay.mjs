#!/usr/bin/env node
/**
 * ============================================================================
 * dsh-chronicle · 离线回放 CLI
 * ============================================================================
 *
 * 【用途】
 *   直接读 DSH 已落盘的会话日志（`~/.dsh/sessions/<工作区>/session-<id>/`），
 *   用本包**同一份**折叠定义复算，打印这个会话的两份实录：
 *     - 专题线（本末体）：每轮干了什么、结局如何
 *     - 实体档案（纪传体）：碰过哪些工具 / 文件 / 网址
 *
 *   它不依赖 DSH 在跑，也不碰投影注册表 —— 是"验器之器"：既用来验证
 *   `apply` 的折叠正确，也用来随时查历史会话。
 *
 * 【用法】
 *   node lib/replay.mjs                     列出全部会话（按时间倒序）
 *   node lib/replay.mjs --last              回放最近一条
 *   node lib/replay.mjs --session <id前缀>  回放匹配的会话
 *   node lib/replay.mjs --all               回放全部（只打摘要行）
 *
 * 【注意】
 *   session 日志是**多帧 zstd**（每帧一个 zstd 魔数 28 b5 2f fd 开头），
 *   必须逐帧解、不是整文件一次解 —— 这是本工作区记过的坑（戒慎第七条）。
 *
 * @module dsh-chronicle/replay
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createChronicleDossierProjection, createChronicleNarrativeProjection } from './projections.js';

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const sessionsRoot = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'sessions');

/**
 * 逐帧解一个多帧 zstd 文件。
 * @param file - 文件路径。
 * @returns 解出的 JSON 行数组。
 */
function readEvents(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf[0] !== MAGIC[0]) {
    // 未压缩：按 JSONL 读。
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

/** 扫描全部会话目录。 */
function listSessions() {
  const found = [];
  if (!fs.existsSync(sessionsRoot)) return found;
  for (const workspace of fs.readdirSync(sessionsRoot)) {
    const wdir = path.join(sessionsRoot, workspace);
    if (!fs.statSync(wdir).isDirectory()) continue;
    for (const entry of fs.readdirSync(wdir)) {
      const sdir = path.join(wdir, entry);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const file of fs.readdirSync(sdir)) {
        // 日志有两种格式：老的 `session.jsonl.zstd` 与当前的
        // `session.v3.jsonl.zstd`（格式代号夹在中间）。只认前缀会整代漏掉
        // —— 实测踩过：9/14 的全部会话都是 v3，按老写法一条都扫不到。
        if (!file.startsWith('session') || !file.includes('.jsonl')) continue;
        const full = path.join(sdir, file);
        const stat = fs.statSync(full);
        found.push({ id: entry.replace(/^session-/, ''), workspace, file: full, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** 用投影定义回放事件。 */
function replay(session) {
  const lines = readEvents(session.file);
  const dossierDef = createChronicleDossierProjection();
  const narrativeDef = createChronicleNarrativeProjection();
  let dossier = dossierDef.init();
  let narrative = narrativeDef.init();
  let events = 0;
  for (const line of lines) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    events += 1;
    dossier = dossierDef.apply(dossier, event);
    narrative = narrativeDef.apply(narrative, event);
  }
  // 顺带用两份 stateSchema 自检：折叠出的状态必须过得了自己声明的 schema。
  const checks = [
    ['chronicleDossier', () => dossierDef.stateSchema.parse(dossier)],
    ['chronicleNarrative', () => narrativeDef.stateSchema.parse(narrative)],
  ];
  const errors = [];
  for (const [key, run] of checks) {
    try { run(); } catch (error) { errors.push(`${key}: ${error.message.split('\n')[0]}`); }
  }
  return { events, dossier, narrative, errors };
}

const args = process.argv.slice(2);
const sessions = listSessions();
if (sessions.length === 0) { console.log('没有找到会话日志：' + sessionsRoot); process.exit(1); }

const pick = (() => {
  const i = args.indexOf('--session');
  if (i >= 0 && args[i + 1]) return sessions.filter((s) => s.id.startsWith(args[i + 1]));
  if (args.includes('--last')) return sessions.slice(0, 1);
  if (args.includes('--all')) return sessions;
  return [];
})();

if (pick.length === 0) {
  console.log(`共 ${sessions.length} 条会话日志（按时间倒序）：\n`);
  for (const s of sessions.slice(0, 25)) {
    const when = new Date(s.mtime).toLocaleString('zh-CN', { hour12: false });
    console.log(`  ${s.id.slice(0, 8)}  ${when}  ${String(Math.round(s.size / 1024)).padStart(7)} KB  ${s.workspace}`);
  }
  console.log('\n用法：--last ｜ --session <id前缀> ｜ --all');
  process.exit(0);
}

for (const session of pick) {
  const { events, dossier, narrative, errors } = replay(session);
  const when = new Date(session.mtime).toLocaleString('zh-CN', { hour12: false });
  console.log('═'.repeat(78));
  console.log(`会话 ${session.id}   ${when}   事件 ${events} 条`);
  console.log(`工作区 ${session.workspace}   日志 ${Math.round(session.size / 1024)} KB`);
  console.log(`自检 ${errors.length === 0 ? '✅ 两份 state 均通过自己的 schema' : '❌ ' + errors.join(' | ')}`);

  console.log(`\n── 专题线（本末体）· 保留 ${narrative.topics.length} 条${narrative.draft ? ' + 1 条进行中' : ''}${narrative.topics.length >= 40 ? '（上限 40，更早的已滚出，总账见文末）' : ''} ──`);
  const rows = [...narrative.topics];
  if (narrative.draft) rows.push({ ...narrative.draft, endSeq: -1, status: '进行中' });
  for (const t of rows.slice(-12)) {
    const mark = t.status === 'done' ? '✅' : t.status === 'aborted' ? '⛔' : t.status === 'error' ? '❌' : '⏳';
    console.log(`  ${mark} 第 ${t.turn} 轮  seq ${t.startSeq}${t.endSeq >= 0 ? '~' + t.endSeq : '~'}  ${t.status}`);
    console.log(`      意图：${t.intent === '' ? '（未捕捉到本人指令）' : t.intent}`);
    console.log(`      步 ${t.steps} · 调用 ${t.calls} · 工具 ${t.tools.join('/') || '—'}${t.followUps > 0 ? ` · 追加指令 ${t.followUps} 条` : ''}${t.filesOmitted > 0 ? ` · 另有 ${t.filesOmitted} 条路径未列` : ''}`);
    if (t.notes && t.notes.length > 0) console.log(`      追加：${t.notes.join(' ǀ ')}`);
    if (t.files.length > 0) console.log(`      触及：${t.files.slice(0, 4).join('  ')}${t.files.length > 4 ? ` …+${t.files.length - 4}` : ''}`);
  }

  const byKind = { tool: [], file: [], dir: [], url: [] };
  for (const key of dossier.order) {
    const entity = dossier.entities[key];
    if (entity === undefined) continue;
    (byKind[entity.kind] ??= []).push(entity);
  }
  console.log('\n── 实体档案（纪传体）──');
  const label = { tool: '工具', file: '文件', dir: '目录', url: '网址' };
  for (const kind of ['tool', 'file', 'dir', 'url']) {
    const list = (byKind[kind] ?? []).sort((a, b) => b.hits - a.hits);
    console.log(`  【${label[kind]}】${list.length} 个`);
    for (const entity of list.slice(0, 12)) {
      const id = entity.id.length > 68 ? entity.id.slice(0, 65) + '…' : entity.id;
      console.log(`      ×${String(entity.hits).padStart(4)}  seq ${entity.firstSeq}~${entity.lastSeq}  ${id}`);
    }
    if (list.length > 12) console.log(`      …另有 ${list.length - 12} 个`);
  }
  if (dossier.evicted > 0 || dossier.dropped > 0) console.log(`   （LRU 淘汰 ${dossier.evicted} 个 · 连淘汰都没救下的 ${dossier.dropped} 次）`);

  // 总账：只增不减，不受 topics 只留最近 40 条的截断影响。
  const st = narrative.stats;
  console.log('\n── 总账（本末体累计，不随截断丢失）──');
  console.log(`  已了结 ${st.turns} 轮 · 其中多指令 ${st.multiIntent} 轮 · 追加指令共 ${st.followUps} 条 · 因列表满未列路径 ${st.filesOmitted} 条`);
  console.log('');
}
