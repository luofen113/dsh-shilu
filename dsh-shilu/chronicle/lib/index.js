/**
 * ============================================================================
 * dsh-chronicle —— 会话实录插件（宿主半侧入口）
 * ============================================================================
 *
 * 【做什么】
 *   往会话投影注册表（`ctx.sessionProjections`）注册两个**宿主侧**折叠单元：
 *     - `chronicleDossier`   —— 纪传体：碰过哪些工具 / 文件 / 网址
 *     - `chronicleNarrative` —— 本末体：有哪几条专题线
 *   数据由投影接缝负责订阅、按会话 watermark 缓存、变更通知与落盘
 *   （`session-projection-cache` 会写进 `~/.dsh/storages/session_projcache/`），
 *   本插件只提供**纯折叠**，不碰订阅、不碰 IO。
 *
 * 【为什么 host-only】
 *   两个单元都不带 `wire`（无浏览器视图）：本包不提供 client.js，也不注册
 *   任何 UI 插槽。读取路径有二：
 *     1. 宿主侧代码 `ctx.sessionProjections.stateOf(session, 'chronicleDossier')`；
 *     2. 离线回放 CLI：`node lib/replay.mjs [--session <id>]` —— 直接读已落盘的
 *        session 日志复算，不依赖 DSH 在跑。
 *
 * 【卸载】
 *   注册是 fiber 上的 effect：插件卸载，两个 key 即从快照与驱动中消失。
 *
 * @module dsh-chronicle
 */
import { createChronicleDossierProjection, createChronicleNarrativeProjection } from './projections.js';

/** Cordis 插件名。 */
const name = 'chronicle';

/** 投影注册表是本插件唯一的依赖；拿不到它，fiber 保持挂起。 */
const inject = ['sessionProjections'];

/**
 * 注册两个投影单元。
 * @param ctx - 携带 `sessionProjections` 的上下文。
 */
function apply(ctx) {
  ctx.sessionProjections.register(createChronicleDossierProjection());
  ctx.sessionProjections.register(createChronicleNarrativeProjection());
}

export { apply, inject, name };
