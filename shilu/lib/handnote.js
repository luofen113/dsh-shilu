/**
 * 卷三手记 —— 往《DSH实录》之「卷三 · 共用手记」追加一札。
 *
 * 铁律：**只增不改**（凡例 handnote.append_only）。新札附于卷三之末，
 * 于下一个 `## ` 级标题之前插入；旧札一字不动。
 * 格式照现本：`### 第N札 · 作者致收者：题` + 空行 + `**日期 · 作者书**` + 空行 + `收者：` + 空行 + 正文。
 *
 * 自验之法：令环境变量 `SHILU_CHRONICLE` 指向实录之**副本**，先试再动真本。
 *
 * @module dsh-shilu/handnote
 */
import fs from 'node:fs';

const HAN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 1–99 → 汉字序数（一、十、十一、二十、二十一…）。
 * @param n - 正整数。
 * @returns 汉字序数。
 */
export function hanzi(n) {
  if (n <= 0 || n > 99) return String(n);
  if (n < 10) return HAN[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : HAN[tens]}十${ones === 0 ? '' : HAN[ones]}`;
}

/** 找到卷三之界：[锚点行, 结束行)，结束行为下一个 `## ` 标题之行号（或文件末）。 */
function sectionBounds(lines, anchor) {
  const start = lines.findIndex((l) => l.trim() === anchor);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** 数卷三现有之札数。 */
function countNotes(lines, bounds) {
  let n = 0;
  for (let i = bounds.start; i < bounds.end; i += 1) if (/^### 第.+札/.test(lines[i])) n += 1;
  return n;
}

/**
 * 生成一札之正文块（不改文件）。
 * @param input - { no, author, to, subject, date, body, evidence }。
 * @returns 该札之 markdown 文本（含末尾空行）。
 */
export function renderNote(input) {
  const { no, author, to, subject, date, body } = input;
  const out = [
    `### 第${hanzi(no)}札 · ${author}致${to}：${subject}`,
    '',
    `**${date} · ${author}书**`,
    '',
    `${to}：`,
    '',
    String(body).trimEnd(),
    '',
  ];
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter((x) => String(x ?? '').trim()) : [];
  if (evidence.length) out.push(`> **凭**：${evidence.map((x) => String(x).trim()).join(' ｜ ')}`, '');
  return out.join('\n');
}

/**
 * 追加一札。
 * @param input - { to, subject, body, date, evidence, author, dryRun, path, anchor }。
 * @returns {{ ok: boolean, reason?: string, path: string, no: number, block: string, bytes: number, dryRun: boolean }}。
 */
export function appendHandnote(input) {
  const file = input.path ?? process.env.SHILU_CHRONICLE ?? 'F:\\AI\\DSH\\DSH实录.md';
  const anchor = input.anchor ?? '## 卷三 · 共用手记';
  if (!fs.existsSync(file)) return { ok: false, reason: `实录不在：${file}`, path: file, no: 0, block: '', bytes: 0, dryRun: true };
  if (!input.to || !input.subject || !input.body) return { ok: false, reason: 'to / subject / body 三者不可缺', path: file, no: 0, block: '', bytes: 0, dryRun: true };
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const bounds = sectionBounds(lines, anchor);
  if (!bounds) return { ok: false, reason: `找不到卷三锚点「${anchor}」`, path: file, no: 0, block: '', bytes: 0, dryRun: true };
  const no = countNotes(lines, bounds) + 1;
  const block = renderNote({ ...input, no, author: input.author ?? '小鲸' });
  if (input.dryRun) return { ok: true, path: file, no, block, bytes: Buffer.byteLength(block), dryRun: true };
  const before = lines.slice(0, bounds.end);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  const after = lines.slice(bounds.end);
  const next = [...before, '', ...block.split('\n'), ...after].join(eol);
  fs.writeFileSync(file, next, 'utf8');
  return { ok: true, path: file, no, block, bytes: Buffer.byteLength(next) - Buffer.byteLength(raw), dryRun: false };
}
