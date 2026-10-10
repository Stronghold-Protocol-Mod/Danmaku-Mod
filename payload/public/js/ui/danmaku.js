// public/js/ui/danmaku.js — the 弹幕 (danmaku) MOD's client half (docs/MOD-DANMAKU.md).
//
// Comments scroll RIGHT→LEFT across the screen, video-site style, and they are driven by what actually happens in the
// match — a DanmakuSpire-style audience reacting to the player's play. Two channels feed the layer:
//
//   1. PERFORMANCE (automatic). The director (createDanmakuDirector) watches the events a client already receives — the
//      typed broadcast ticker (store.ticker: shop level, golden operator, gifts, char damage, boss hits, bond layers), the
//      player's own private/public deltas (LP, elimination) and the match result — and turns them into reaction lines
//      from the rule set in data/danmaku.json (the match's own opening line included: MATCH_START, 卫戍协议，启动！).
//      * OUTSIDE 联防 every line is SELF: only the player's OWN signals react, so each player sees their own stream.
//      * DURING 联防阶段 (PHASE.UNITE) the director ingests EVERY player's broadcast signals instead, and every client
//        derives from the same deterministic broadcast — so the pool becomes SHARED, identically, on every screen.
//   2. EMOTES (player-sent). The only player-authored line: sending an emote (g.emote → the room-wide m.emote push) also
//      drops that emote into the stream as a danmaku. It is anonymous (no player name) and NOT free text — the emote
//      wheel is the whole input surface. Emotes are already broadcast, so this channel is shared by construction.
//   3. THE LOCAL BATTLE (automatic, SELF ONLY). "吓哭了": ONE operator owned a battle — it out-damaged the field, or
//      killed half its enemies, or held a monster under control. The client simulates its own battle itself
//      (public/js/battle/runner.js), so that runner's public bus carries what the wire does not: every monster that
//      spawned with its HP, the control statuses they walked into, and the live per-unit damage / kill numbers. All of
//      it is LOCAL to this client, so these lines can never be part of the shared pool (createBattleFeatTracker).
//
// The mod is data-driven by the same contract as 罗德岛: this module is ALWAYS loaded and inert until /data/danmaku.json
// carries its records — the record's `isMod` flag is the presence marker (the `marker` of its registry entry,
// mod/toggles.d/danmaku.json), so switching the mod OFF (the 内容开关, server/mod/toggle.js) leaves a bare `{}` and the
// overlay renders nothing at all. Nothing here reads the mod-state plumbing: the data file IS the switch.
//
// It is MOUNTED the same way: `mount()` (below) is the contract a mod's client module has with the framework — the
// slice names `client: "js/ui/danmaku.js"`, ui/modBadge.js imports it while the mod is ON and calls `mount()`, and the
// cleanup it returns unmounts it again. main.js names no mod, and the two mods never patch the same file to be mounted.
//
// The playback model is split so the interesting half is testable without a DOM:
//   * the PURE engine (normalizeDanmaku / createDanmakuEngine / createDanmakuDirector / the helpers) — lanes, timing, the
//     weighted draw and the event→line rules — is plain arithmetic over `rem`, the client's responsive root (theme.css:
//     1rem ≈ viewport/19.2), and over plain store snapshots;
//   * the Preact overlay (DanmakuHost / DanmakuOverlay) turns engine ticks into absolutely-positioned spans whose CSS
//     animation is the right→left march. A comment's lifetime is (viewport + its own width) / speed, so long lines take
//     proportionally longer and every line travels at the SAME speed — constant speed, not constant duration.
//
// A lane is the horizontal track one comment rides. It frees again once that comment has fully entered the screen (its
// tail cleared the right edge = ownWidth / speed seconds), and a burst only ever fills free lanes, so two comments can
// never overlap inside one lane. Styles: public/css/danmaku.css (injected on first use when the page does not link it).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { html } from './components.js';
import { EmoteArt } from './emotes.js';
import { data, useData } from '../data.js';
import { selectRoute, store, useStore } from '../store.js';
import { battleRunner } from '../battle/runner.js';
import { PHASE } from '../../../shared/constants.js';

/** The stylesheet the overlay needs (linked by index.html; injected by dev harnesses). */
export const DANMAKU_CSS_HREF = '/css/danmaku.css';

/** The router screens a config may name (public/js/store.js selectRoute). */
export const DANMAKU_SCREENS = Object.freeze(['title', 'lobby', 'room', 'game']);

/** The BROADCAST events a `rules` block may key off — fired by one typed ticker line each. */
export const DANMAKU_BROADCAST_EVENTS = Object.freeze([
  'SHOP_LEVEL', 'GOLDEN_CHAR', 'CHAR_GIFT', 'CHAR_DAMAGE', 'BOSS_HIT', 'BOND_EFFECT',
  'UNITE', 'LP_LOSS', 'ELIMINATED', 'RESULT_WIN', 'RESULT_LOSS',
]);

/**
 * The STATE events: not a broadcast but a condition over the store the director re-reads on every feed. Each rule for
 * one of these carries its own thresholds (see DANMAKU_STATE_DEFAULTS) so a data author tunes them without touching code,
 * and each such rule fires AT MOST ONCE PER MATCH.
 *   * MATCH_START     — a new match began: this client's view left the lobby and entered one of the opening phases
 *                       (MATCH_OPEN_PHASES). No condition and no player count — one player or four, it announces.
 *                       Shared (every client in the room reads the same `m.public.phase`).
 *   * ALL_LEAKED      — every player in the room lost LP in the same round (the whole room leaked). Shared.
 *   * REFRESH_STREAK  — the player runs `refreshes` CONSECUTIVE shop refreshes (free ones count, `stats.refreshes`
 *                       includes them) without a shop purchase / a merge / a shop upgrade in between. Self.
 *   * BOND_COUNT      — the player's own board first reaches `count` distinct operators of `bond` (炎 6 / 9 …). Self.
 *   * BATTLE_FEAT     — ONE operator of the player's own battle owned it: it dealt `dmgPct` of every monster's HP, or it
 *                       killed `killPct` of the round's enemies, or a monster stood under its control for `controlSec`.
 *                       Self (fed by createBattleFeatTracker — this client's own simulation).
 */
export const DANMAKU_STATE_EVENTS = Object.freeze(['MATCH_START', 'ALL_LEAKED', 'REFRESH_STREAK', 'BOND_COUNT', 'BATTLE_FEAT']);

/** The condition fields of each STATE event, with the default a rule omits them for (MATCH_START has none). */
export const DANMAKU_STATE_DEFAULTS = Object.freeze({
  MATCH_START: Object.freeze({}),
  ALL_LEAKED: Object.freeze({ minPlayers: 4 }),
  REFRESH_STREAK: Object.freeze({ refreshes: 7 }),
  BOND_COUNT: Object.freeze({ bond: 'yanShip', count: 1 }),
  BATTLE_FEAT: Object.freeze({ dmgPct: 0.65, controlSec: 25, killPct: 0.5 }),
});

/**
 * The statuses BATTLE_FEAT counts as CONTROL over a monster. This is the one thing the sim's client event stream can
 * measure on its own — shared/protocol.js ships `['status', unitId, key, 1|0]`, the on/off edge only, with no source —
 * so the tracker times the MONSTER, not the operator. 寒冷 is in on purpose: it is what 谢拉格不融冰 lands (12 % per
 * attack of 1.5 s of 寒冷), and the 谢拉格 pair turns a cold into 冻结 — the build the rule exists for.
 */
export const DANMAKU_CONTROL_STATUSES = Object.freeze(['stun', 'freeze', 'sleep', 'bind', 'cold']);

/** The events a `rules` block may key off — the director's whole vocabulary. */
export const DANMAKU_EVENTS = Object.freeze([...DANMAKU_BROADCAST_EVENTS, ...DANMAKU_STATE_EVENTS]);

/** How often the overlay asks the engine for the next ambient burst. */
export const SPAWN_TICK_MS = 200;

/** Hard ceiling on live comments (a runaway config cannot flood the DOM). */
export const MAX_LIVE = 80;

/** The reference viewport width in `rem` (1920 ÷ the theme's 100 px root) — the fallback the engine measures against. */
export const DEFAULT_VIEWPORT_REM = 19.2;

/** Link public/css/danmaku.css once when the host page does not (dev harnesses); no-op outside a browser. */
export function ensureDanmakuCss(doc = globalThis.document) {
  if (!doc?.head || typeof doc.querySelector !== 'function') return false;
  if (doc.querySelector(`link[rel="stylesheet"][href$="${DANMAKU_CSS_HREF}"]`)) return false;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = DANMAKU_CSS_HREF;
  doc.head.appendChild(link);
  return true;
}

/** Whether a /data/danmaku.json payload is the mod's ON state (its `isMod` marker is present). */
export function isDanmakuOn(raw) {
  return !!(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.isMod);
}

/**
 * The viewport width in `rem`, so the engine's timings are resolution-independent. Falls back to the 1920 reference
 * whenever the root font size or the window is unavailable (a non-browser caller, a jsdom stub).
 * @param {Document} [doc]
 */
export function viewportRem(doc = globalThis.document) {
  try {
    const rootPx = parseFloat(globalThis.getComputedStyle?.(doc?.documentElement)?.fontSize || '');
    const widthPx = Number(globalThis.innerWidth);
    if (rootPx > 0 && Number.isFinite(widthPx) && widthPx > 0) return widthPx / rootPx;
  } catch { /* fall through to the reference */ }
  return DEFAULT_VIEWPORT_REM;
}

/**
 * A line pool entry: `{ text, color, weight }`, weight ≥ 0 (0 = never drawn, the way a data author parks a line).
 * @param {any} list
 * @returns {{ text: string, color: string|null, weight: number }[]}
 */
export function messagesOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.text : null;
    if (typeof text !== 'string' || !text.trim()) continue;
    const color = raw && typeof raw === 'object' && typeof raw.color === 'string' && raw.color ? raw.color : null;
    const w = raw && typeof raw === 'object' ? Number(raw.weight) : 1;
    out.push({ text, color, weight: Number.isFinite(w) && w >= 0 ? w : 1 });
  }
  return out;
}

/**
 * A rule written long form (an object with a `lines` array) — the shape an array of rules is made of.
 * @param {any} v
 */
const isRuleObject = (v) => !!(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.lines));

/**
 * The validated event rules, as `{ [event]: Rule[] }` — a list, so several rules may share one STATE event (炎 6 AND
 * 炎 9 are two rules of the one BOND_COUNT event; the first whose condition holds fires, each at most once a match).
 * A BROADCAST event simply has the single rule its one ticker line draws from.
 *
 * A rule may be written short (just the array of lines), long (`{ "lines": [...] }`), or as an ARRAY of long rules
 * (`[ { "bond": "yanShip", "count": 6, … }, { "bond": "yanShip", "count": 9, … } ]`). An event absent from the data
 * never reacts (that is how a data author silences one without editing code); an event the code does not know is dropped.
 *
 * Each rule is `{ lines, color, …conditions }` — the condition fields come from DANMAKU_STATE_DEFAULTS for a STATE event
 * and are empty for a broadcast one.
 * @param {any} raw
 * @returns {Record<string, { lines: { text: string, color: string|null, weight: number }[], color: string|null,
 *   minPlayers?: number, refreshes?: number, bond?: string, count?: number }[]>}
 */
export function rulesOf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [event, spec] of Object.entries(raw)) {
    if (!DANMAKU_EVENTS.includes(event)) continue;
    // an array is a list of long rules only when every entry is one; otherwise it is the short form's line list
    const specs = Array.isArray(spec) && spec.length && spec.every(isRuleObject)
      ? spec
      : [Array.isArray(spec) ? { lines: spec } : spec];
    const rules = [];
    for (const s of specs) {
      if (!isRuleObject(s)) continue;
      const lines = messagesOf(s.lines);
      if (!lines.length) continue;
      rules.push({ lines, color: typeof s.color === 'string' && s.color ? s.color : null, ...conditionsOf(event, s) });
    }
    if (rules.length) out[event] = rules;
  }
  return out;
}

/**
 * The condition fields a rule carries for its STATE event ({} for a broadcast event, whose only trigger is the ticker).
 * @param {string} event
 * @param {any} spec
 */
function conditionsOf(event, spec) {
  const defaults = DANMAKU_STATE_DEFAULTS[event];
  if (!defaults) return {};
  const out = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'bond') out.bond = typeof spec.bond === 'string' && spec.bond ? spec.bond : fallback;
    else out[key] = num(spec[key], fallback, 0, 100_000);
  }
  return out;
}

/** Clamp-with-default for a numeric config field. */
const num = (v, fallback, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * The playback config of a /data/danmaku.json payload, or null when the mod is OFF / the payload is unusable.
 * Every field is clamped into a sane range so a hand-written data file can never stall or flood the overlay.
 *
 * The record always yields a config (the layer is useful even with no idle pool and no rules), so a data file with only
 * `{ "isMod": true }` still turns the mod ON — it just produces no lines until it is given some.
 * @param {any} raw
 * @returns {{ screens: string[], lanes: number, topPad: number, fontSize: number, laneHeight: number, speed: number,
 *   opacity: number, idleGapMs: number, idleGapJitterMs: number, burstMin: number, burstMax: number, emoteRem: number,
 *   messages: { text: string, color: string|null, weight: number }[],
 *   rules: Record<string, { lines: { text: string, color: string|null, weight: number }[], color: string|null,
 *     minPlayers?: number, refreshes?: number, bond?: string, count?: number }[]> } | null}
 */
export function normalizeDanmaku(raw) {
  if (!isDanmakuOn(raw)) return null;
  const fontSize = num(raw.fontSize, 0.22, 0.1, 0.6);
  const burst = Array.isArray(raw.burst) ? raw.burst : [];
  const burstMin = Math.floor(num(burst[0], 1, 1, 8));
  const burstMax = Math.max(burstMin, Math.floor(num(burst[1], burstMin, 1, 8)));
  const screens = Array.isArray(raw.screens) ? DANMAKU_SCREENS.filter((s) => raw.screens.includes(s)) : DANMAKU_SCREENS.slice();
  return {
    screens,
    lanes: Math.floor(num(raw.lanes, 12, 1, 40)),
    topPad: num(raw.topPad, 0.34, 0, 8),
    fontSize,
    laneHeight: num(raw.laneHeight, fontSize * 1.7, fontSize, 3),
    speed: num(raw.speed, 2.6, 0.4, 30),
    opacity: num(raw.opacity, 0.88, 0.1, 1),
    // the AMBIENT stream (messages) is deliberately slower than the reaction stream (rules), which is injected rather
    // than spawned — otherwise a busy round would drown the screen in filler.
    idleGapMs: num(raw.idleGapMs ?? raw.gapMs, 2600, 60, 120_000),
    idleGapJitterMs: num(raw.idleGapJitterMs ?? raw.gapJitterMs, 900, 0, 120_000),
    burstMin,
    burstMax,
    messages: messagesOf(raw.messages),
    rules: rulesOf(raw.rules),
    /**
     * The rem box a danmaku'd emote occupies (it rides a lane like a text comment). Deliberately SEVERAL line heights
     * tall (2.6 × the font): an emote reads as a sticker the player dropped into the stream, not as text. It is the
     * width the engine reserves and the size the overlay renders, so the two can never disagree.
     */
    emoteRem: num(raw.emoteRem, fontSize * 2.6, 0.06, 2),
  };
}

// CJK / full-width / Hangul glyphs render ~1 em wide; everything else is estimated at ~0.55 em. Only the lane timing and
// the CSS duration read this, and both are self-correcting (a wider line just leaves a little more gap behind it).
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * Estimated rendered width of a message, in `rem` (fontSize is in rem). Used for lane spacing and the animation duration
 * only — never for layout.
 * @param {string} text
 * @param {number} fontSize
 */
export function estimateWidthRem(text, fontSize) {
  let units = 0;
  for (const ch of String(text ?? '')) units += WIDE.test(ch) ? 1 : 0.55;
  return units * fontSize;
}

/**
 * Weighted random pick. Zero-weight entries are never drawn but still part of the pool; an all-zero pool falls back to a
 * uniform draw, so a data author cannot accidentally freeze the stream.
 * @template {{ weight: number }} T
 * @param {T[]} list
 * @param {() => number} [rand]
 * @returns {T|null}
 */
export function weightedPick(list, rand = Math.random) {
  if (!Array.isArray(list) || !list.length) return null;
  let total = 0;
  for (const m of list) total += m.weight > 0 ? m.weight : 0;
  if (!(total > 0)) return list[Math.min(list.length - 1, Math.floor(rand() * list.length))] ?? list[0];
  let r = rand() * total;
  for (const m of list) {
    r -= m.weight > 0 ? m.weight : 0;
    if (r < 0) return m;
  }
  return list[list.length - 1];
}

/**
 * Fill `{key}` placeholders in a rule line from a vars map; an unknown key is left verbatim (so a typo is visible in the
 * line rather than silently blanking it).
 * @param {string} text
 * @param {Record<string, any>} [vars]
 */
export function fillTemplate(text, vars) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (whole, key) => (vars && vars[key] != null ? String(vars[key]) : whole));
}

/**
 * @typedef {{ id: string, lane: number, top: number, text: string, emote: string|null, color: string|null,
 *   durationMs: number }} DanmakuItem
 */

/**
 * The pure playback engine: which comments to launch, on which lane, for how long.
 *
 * `spawn(now)` is the AMBIENT stream (the idle pool at its own cadence) and returns the comments due since the last
 * call; `inject(...)` pushes ONE comment immediately — that is the channel every performance line and every emote rides,
 * because a reaction must not wait for the filler's cadence. Both mark their lanes busy. Nothing here touches the DOM.
 *
 * @param {NonNullable<ReturnType<typeof normalizeDanmaku>>} cfg
 * @param {{ viewportRem?: number, random?: () => number }} [opts]
 * @returns {{ lanes: number, spawn: (nowMs: number) => DanmakuItem[],
 *   inject: (text: string, opts?: { color?: string, emote?: string|null, widthRem?: number }, nowMs?: number) => DanmakuItem|null }}
 */
export function createDanmakuEngine(cfg, { viewportRem: vw = DEFAULT_VIEWPORT_REM, random = Math.random } = {}) {
  const laneFreeAt = new Array(cfg.lanes).fill(-Infinity);
  let nextAt = -Infinity;
  let seq = 0;

  const freeLanes = (now) => {
    const free = [];
    for (let l = 0; l < laneFreeAt.length; l++) if (laneFreeAt[l] <= now) free.push(l);
    return free;
  };
  /** Land one comment on a free lane (the caller guarantees `free` is not empty). */
  const land = (text, emote, color, now, free, widthRem) => {
    const lane = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
    // The lane frees once the tail has cleared the right edge; the comment lives until its nose clears the left edge —
    // the two numbers the CSS animation is timed by.
    laneFreeAt[lane] = now + (widthRem / cfg.speed) * 1000;
    return {
      id: `dm${++seq}`,
      lane,
      top: cfg.topPad + lane * cfg.laneHeight,
      text,
      emote,
      color,
      durationMs: Math.round(((vw + widthRem) / cfg.speed) * 1000),
    };
  };

  return {
    get lanes() { return cfg.lanes; },
    /** The ambient comments to launch at `nowMs`, or [] while the cadence and every lane are still busy. */
    spawn(nowMsArg) {
      const now = Number.isFinite(nowMsArg) ? nowMsArg : 0;
      if (now < nextAt) return [];
      nextAt = now + cfg.idleGapMs + random() * cfg.idleGapJitterMs;
      const want = cfg.burstMin + Math.floor(random() * (cfg.burstMax - cfg.burstMin + 1));
      const out = [];
      for (let i = 0; i < want; i++) {
        const free = freeLanes(now);
        if (!free.length) break;
        const msg = weightedPick(cfg.messages, random);
        if (!msg) break;
        out.push(land(msg.text, null, msg.color, now, free, estimateWidthRem(msg.text, cfg.fontSize)));
      }
      return out;
    },
    /**
     * Force one comment into a free lane (null when every lane is busy, or when there is nothing to show) — the channel
     * both the performance rules and the emote pushes ride.
     */
    inject(text, opts = {}, nowMsArg = 0) {
      const now = Number.isFinite(nowMsArg) ? nowMsArg : 0;
      const emote = typeof opts?.emote === 'string' && opts.emote ? opts.emote : null;
      const label = typeof text === 'string' ? text : '';
      if (!emote && !label.trim()) return null;
      const free = freeLanes(now);
      if (!free.length) return null;
      const color = typeof opts?.color === 'string' && opts.color ? opts.color : null;
      const width = emote
        ? (Number.isFinite(opts?.widthRem) && opts.widthRem > 0 ? opts.widthRem : cfg.emoteRem)
        : estimateWidthRem(label, cfg.fontSize);
      return land(label, emote, color, now, free, width);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The director — in-match performance → reaction lines
// ---------------------------------------------------------------------------------------------------

/** The `PHASE` value that switches the pool from per-player to shared (联防阶段). */
export const UNITE_PHASE = PHASE.UNITE;

/**
 * The phases a match passes through BEFORE its first battle — the window in which "this match just began" is true, and
 * the one thing MATCH_START is judged on. A client whose first look at a match is already past them (a page reload, a
 * late join, a spectator arriving mid-round) stays silent, exactly as the seeding feed keeps it from replaying anything
 * else it was not there for.
 */
export const MATCH_OPEN_PHASES = Object.freeze([PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK, PHASE.ROUND_START]);

/**
 * Whether `m.public.phase` says a match is on screen: any phase past the lobby. A finished match's RESULT is deliberately
 * NOT live — the result screen is still up, but that match is over, which is what lets the next one announce itself.
 * @param {string|null|undefined} phase
 */
const matchLive = (phase) => phase != null && phase !== PHASE.LOBBY && phase !== PHASE.RESULT;

/**
 * The battle-feat tracker — the numbers a BATTLE_FEAT rule is judged from, accumulated from the LOCAL battle this client
 * simulates itself (public/js/battle/runner.js; its public bus carries what the wire does not). No DOM, no timer, no
 * randomness: the director's verdict stays plain arithmetic over it.
 *
 * What the stream gives for free, and what it does not:
 *   * `['spawn', UnitInfo]` — every unit that ever appeared, with `side`, `kind`, `ownerId` and `maxHp`. Monsters are
 *     summed into `hpTotal` and counted into `enemies`: EVERY spawned monster, summons / splits / leader parts included —
 *     the denominator the damage share and the kill share are read against. The same tuple names this player's own
 *     operators, which is how their live numbers are reached afterwards.
 *   * `['status', unitId, key, 1|0]` — a monster entering / leaving a status. One of DANMAKU_CONTROL_STATUSES counts as
 *     control, and a monster counts as controlled while it carries ANY of them; the tracker keeps the LONGEST single
 *     stretch one monster stood under. The tuple carries no SOURCE, so the operator behind a stretch is not knowable
 *     from the stream — what is timed here is the monster.
 *   * The per-operator damage and the kills are nowhere on the wire. They come from the runner's own live accessor
 *     (`battleRunner.unitStats` — the very numbers the detail card reads) and are folded in through `observe()`.
 *
 * @returns {{ begin: (battleId: string|null) => boolean, feedEv: (frame: any, o?: { selfId?: string|null }) => boolean,
 *   observe: (samples?: any[]) => boolean, finish: () => boolean, ownUnitIds: () => number[],
 *   feats: { hpTotal: number, maxHoldMs: number, bestDmg: number, bestKills: number, enemies: number } }}
 */
export function createBattleFeatTracker() {
  const held = new Map();   // monster unitId → the Set of control statuses it carries right now
  const since = new Map();  // monster unitId → the game time (s) its current controlled stretch began
  const own = new Set();    // this player's own operator unit ids, seen spawning
  let key = null;           // the battle the numbers belong to (store.match.battle.battleId)
  let selfId = null;
  let lastGt = 0;
  let hpTotal = 0;
  let enemies = 0;
  let maxHoldMs = 0;
  let bestDmg = 0;
  let bestKills = 0;

  /** Close `id`'s controlled stretch at `gt` (seconds), keeping it when it beats the longest one so far. */
  const closeHold = (id, gt) => {
    const at = since.get(id);
    if (at == null) return false;
    since.delete(id);
    const ms = Math.max(0, (Number(gt) - at) * 1000);
    if (!(ms > maxHoldMs)) return false;
    maxHoldMs = ms;
    return true;
  };

  return {
    /** Point the tracker at a battle (`battleId`, null when none is on screen). A change RESETS every number. */
    begin(battleId) {
      const next = battleId ?? null;
      if (next === key) return false;
      key = next;
      held.clear(); since.clear(); own.clear();
      selfId = null; lastGt = 0;
      hpTotal = 0; enemies = 0; maxHoldMs = 0; bestDmg = 0; bestKills = 0;
      return true;
    },
    /**
     * Consume one `b.ev` frame. Returns true when a monster's controlled stretch just CLOSED — the only moment the
     * control number can move — which is the caller's cue to re-ask the director.
     */
    feedEv(frame, { selfId: me = null } = {}) {
      if (me != null) selfId = me;
      const gt = Number(frame?.gt);
      if (Number.isFinite(gt)) lastGt = gt;
      let moved = false;
      for (const t of frame?.ev || []) {
        if (!Array.isArray(t)) continue;
        if (t[0] === 'spawn') {
          const u = t[1];
          if (!u || !Number.isInteger(u.id)) continue;
          if (u.side === 'enemy') { hpTotal += Math.max(0, Number(u.maxHp) || 0); enemies++; }
          else if (u.kind === 'op' && selfId != null && u.ownerId === selfId) own.add(u.id);
        } else if (t[0] === 'status') {
          const id = t[1];
          if (!Number.isInteger(id) || !DANMAKU_CONTROL_STATUSES.includes(t[2])) continue;
          const on = !!t[3];
          if (on) {
            let set = held.get(id);
            if (!set) held.set(id, (set = new Set()));
            set.add(t[2]);
            if (!since.has(id)) since.set(id, lastGt);
          } else {
            const set = held.get(id);
            if (set) { set.delete(t[2]); if (!set.size) held.delete(id); }
            if (!held.has(id) && closeHold(id, lastGt)) moved = true;
          }
        } else if (t[0] === 'die' || t[0] === 'leak') {
          const id = t[1];
          held.delete(id);
          if (closeHold(id, lastGt)) moved = true;
        }
      }
      return moved;
    },
    /**
     * Fold in one live look at this player's own operators (samples of `battleRunner.unitStats`). Returns true when a
     * number actually moved, so the caller re-asks the director only then.
     */
    observe(samples = []) {
      let moved = false;
      for (const u of samples) {
        if (!u) continue;
        const dmg = Number(u.dmg) || 0;
        const kills = Math.max(0, Math.trunc(Number(u.kills) || 0));
        if (dmg > bestDmg) { bestDmg = dmg; moved = true; }
        if (kills > bestKills) { bestKills = kills; moved = true; }
      }
      return moved;
    },
    /**
     * The battle on screen is over (or gone): the stretches still open are closed at the last game time seen, so a
     * monster held under control right up to the final frame still counts.
     */
    finish() {
      let moved = false;
      for (const id of [...since.keys()]) { held.delete(id); if (closeHold(id, lastGt)) moved = true; }
      return moved;
    },
    /** The unit ids of this player's own operators in the battle on screen (`observe()` is sampled from these). */
    ownUnitIds() { return [...own]; },
    /** The numbers a BATTLE_FEAT rule is judged from (each accumulates within one battle). */
    get feats() { return { hpTotal, maxHoldMs, bestDmg, bestKills, enemies }; },
  };
}

/**
 * The performance director. Feed it the store slices a client already holds; it returns the reaction lines due — one per
 * matched event, never a backlog, and never the same event twice.
 *
 * Scope: outside 联防 only the player's OWN signals react (self display); during 联防 it consumes every player's
 * broadcast signal, so the lines every client derives are identical — the shared pool. The STATE rules follow their own
 * scope (MATCH_START and ALL_LEAKED are shared, the ones about the player are self).
 *
 * @param {NonNullable<ReturnType<typeof normalizeDanmaku>>} cfg
 * @param {{ random?: () => number }} [opts]
 * @returns {{ feed: (snap: { ticker?: any[], emotes?: any[], pub?: any, priv?: any, result?: any, selfId?: string|null,
 *   battle?: { hpTotal: number, maxHoldMs: number, bestDmg: number, bestKills: number, enemies: number } | null })
 *   => { text: string, emote: string|null, color: string|null, scope: 'self'|'shared' }[], reset: () => void }}
 */
export function createDanmakuDirector(cfg, { random = Math.random } = {}) {
  const seenTicker = new Set();
  const seenEmote = new Set();
  /** `event#index` of every STATE rule already spent this match (each fires at most once). */
  const spent = new Set();
  const prev = { phase: null, round: null, lp: null, alive: null, result: null, live: null };
  /** every player's LP as of the current round's start, for the ALL_LEAKED verdict at the round's settle. */
  let roundLp = null;
  /** the REFRESH_STREAK run: the `stats.refreshes` the current run began at, plus the counters that break it. */
  const run = { base: null, buys: null, merges: null, level: null };
  let seeded = false;

  /** One reaction line drawn from ONE rule (the caller has already matched its condition). */
  const lineOf = (rule, vars, scope) => {
    const pick = weightedPick(rule.lines, random);
    if (!pick) return null;
    const text = fillTemplate(pick.text, vars);
    if (!text.trim()) return null;
    return { text, emote: null, color: pick.color ?? rule.color, scope };
  };
  /** The single line a BROADCAST event draws from its one rule, or null when the data carries none. */
  const lineFor = (event, vars, scope) => {
    const rules = cfg.rules[event];
    return rules && rules.length ? lineOf(rules[0], vars, scope) : null;
  };
  /** Run every rule of one STATE event; each that matches and has not fired yet emits one line. */
  const stateRules = (out, event, vars, scope, matches) => {
    const rules = cfg.rules[event];
    if (!rules) return;
    for (const [i, rule] of rules.entries()) {
      const key = `${event}#${i}`;
      if (spent.has(key)) continue;
      if (!matches(rule)) continue;
      spent.add(key);
      push(out, lineOf(rule, vars, scope));
    }
  };
  const push = (out, line) => { if (line) out.push(line); return out; };
  /** Every player's LP as of right now (the round-start snapshot / the settle comparison both read it). */
  const lpByPlayer = (pub) => {
    const m = new Map();
    for (const p of pub?.players || []) if (p && typeof p.lp === 'number') m.set(p.playerId, p.lp);
    return m;
  };
  /** (Re)start the REFRESH_STREAK run — the counters that break it are latched as they are seen. */
  const seedRun = (priv) => {
    const st = priv?.stats;
    run.base = st && Number.isFinite(st.refreshes) ? st.refreshes : null;
    run.buys = st && Number.isFinite(st.buys) ? st.buys : null;
    run.merges = st && Number.isFinite(st.merges) ? st.merges : null;
    run.level = Number.isFinite(priv?.shop?.level) ? priv.shop.level : null;
  };
  /**
   * 已急哭's condition: `stats.refreshes` has climbed `rule.refreshes` times since the run last began, with no purchase,
   * merge or shop upgrade in between to restart it. Needs `stats.buys` (server/match/player/views.js exposes it) — with
   * no such counter the run can never be trusted, so nothing fires.
   * @param {ReturnType<typeof push>} out
   * @param {any} priv
   * @param {number|null} round
   */
  const refreshStreak = (out, priv, round) => {
    const st = priv?.stats;
    if (!st || !Number.isFinite(st.refreshes) || !Number.isFinite(st.buys)) { run.base = null; return; }
    const level = Number.isFinite(priv?.shop?.level) ? priv.shop.level : null;
    if (run.base == null) { seedRun(priv); return; }
    // any of these is "another operation": it ends the run and the next 7 refreshes start a fresh one
    const broke = st.buys !== run.buys || st.merges !== run.merges || level !== run.level;
    if (broke) { seedRun(priv); return; }
    const streak = st.refreshes - run.base;
    stateRules(out, 'REFRESH_STREAK', { round, refreshes: st.refreshes, streak }, 'self', (rule) => streak >= rule.refreshes);
  };
  /** Whether the player's own board has `count` distinct operators of the rule's bond (炎 6 / 9 …). */
  const bondCountReaches = (priv, rule) => {
    const b = Array.isArray(priv?.bonds) ? priv.bonds.find((x) => x && x.bondId === rule.bond) : null;
    return !!(b && Number.isFinite(b.count) && b.count >= rule.count);
  };
  /**
   * 吓哭了's verdict: has ONE operator owned the battle by ANY of the three measures a rule may name? Each measure is a
   * share of a field total the tracker accumulated, so a missing total (no monster seen yet) never matches. A measure
   * switched off with a 0 threshold is skipped, which is how a rule can be narrowed to one kind of showing-off.
   */
  const battleDominates = (feats, rule) => {
    if (feats.hpTotal > 0 && rule.dmgPct > 0 && feats.bestDmg >= rule.dmgPct * feats.hpTotal) return true;
    if (feats.enemies > 0 && rule.killPct > 0 && feats.bestKills >= rule.killPct * feats.enemies) return true;
    return rule.controlSec > 0 && feats.maxHoldMs >= rule.controlSec * 1000;
  };
  /**
   * A new match just began (see `matchLive`): everything that is PER MATCH starts over — the once-per-match rules, the
   * cursors that compare against the previous match's numbers, and the 已急哭 run. The ticker and emote cursors are NOT
   * touched on purpose: their ids come from one page-wide counter (public/js/main.js `seq`), so an id from the match
   * before can never come back and a stale cursor can never swallow a fresh line.
   */
  const newMatch = () => {
    spent.clear();
    prev.round = null; prev.lp = null; prev.alive = null; prev.result = null;
    roundLp = null;
    run.base = run.buys = run.merges = run.level = null;
  };

  return {
    reset() {
      seenTicker.clear(); seenEmote.clear(); spent.clear(); seeded = false;
      prev.phase = prev.round = prev.lp = prev.alive = prev.result = prev.live = null;
      roundLp = null; run.base = run.buys = run.merges = run.level = null;
    },
    feed(snap = {}) {
      const out = [];
      const selfId = snap.selfId ?? null;
      const pub = snap.pub || null;
      const phase = pub?.phase ?? null;
      const round = pub?.round ?? null;
      const unite = phase === UNITE_PHASE;

      // The first feed only seeds the cursors: the store already holds the tail of the stream, and replaying it would
      // open the layer with a backlog of reactions to things that happened before the overlay existed.
      if (!seeded) {
        seeded = true;
        for (const e of snap.ticker || []) if (e?.id != null) seenTicker.add(e.id);
        for (const e of snap.emotes || []) if (e?.seq != null) seenEmote.add(e.seq);
        prev.phase = phase;
        prev.round = round;
        prev.lp = typeof snap.priv?.lp === 'number' ? snap.priv.lp : null;
        prev.alive = snap.priv?.alive ?? null;
        prev.result = snap.result ?? null;
        prev.live = matchLive(phase);
        roundLp = lpByPlayer(pub);
        seedRun(snap.priv);
        return out;
      }

      // 卫戍协议，启动！: a NEW match. The client's view left the lobby (and the previous match's RESULT) behind and
      // entered one of the opening phases — no player count is involved, so a solo match announces itself just like a
      // full room. This is also the one moment the per-match state is cleared, which is what makes "at most once per
      // match" true across consecutive matches in one page session. A client whose FIRST look at a match is already
      // past the opening (a reload, a late join) simply adopts `live` without a line — the seeding feed's rule.
      const live = matchLive(phase);
      if (live && !prev.live && MATCH_OPEN_PHASES.includes(phase)) {
        newMatch();
        stateRules(out, 'MATCH_START', { round }, 'shared', () => true);
      }
      prev.live = live;

      // A new 联防阶段 is the one transition worth announcing — it is when the pool goes shared.
      if (phase !== prev.phase) {
        if (unite) push(out, lineFor('UNITE', { round }, 'shared'));
        prev.phase = phase;
      }

      // 四区兄弟: the whole room leaked this round. settle() has already taken the LP off every player while `pub.round`
      // is still this round, so the verdict is judged against the LP the round STARTED with — re-read on EVERY settle
      // frame (a throttled m.public may open SETTLE before its LP catches up), the rule fired at most once regardless.
      // Boss rounds pool LP into `teamLp` (individual LP is re-synced at the end), so they are never judged this way.
      if (phase === PHASE.SETTLE && round === prev.round && pub?.teamLp == null && roundLp && roundLp.size) {
        const players = pub.players || [];
        const allLeaked = players.length > 0
          && players.every((p) => roundLp.has(p.playerId) && typeof p.lp === 'number' && p.lp < roundLp.get(p.playerId));
        if (allLeaked) {
          stateRules(out, 'ALL_LEAKED', { round, players: players.length }, 'shared',
            (rule) => players.length >= rule.minPlayers);
        }
      }

      // The round's own settlement runs before `pub.round` moves on: the snapshot now belongs to the round that just began.
      if (round !== prev.round) {
        prev.round = round;
        roundLp = lpByPlayer(pub);
      }

      // Broadcast tickers: the room's performance stream. Outside 联防 only our own lines count; inside it, everyone's do.
      for (const e of snap.ticker || []) {
        const id = e?.id;
        if (id == null || seenTicker.has(id)) continue;
        seenTicker.add(id);
        const mine = e.playerId == null || (selfId != null && e.playerId === selfId);
        if (!mine && !unite) continue; // somebody else's play, outside 联防: not ours to show
        const args = Array.isArray(e.args) ? e.args : [];
        const vars = { ...Object.fromEntries(args.map((a, i) => [String(i), a])), round: e.round ?? round };
        push(out, lineFor(e.type, vars, unite ? 'shared' : 'self'));
      }

      // Emotes — anonymous, no free text, and already broadcast: the player-sent channel.
      for (const e of snap.emotes || []) {
        const seq = e?.seq;
        if (seq == null || seenEmote.has(seq)) continue;
        seenEmote.add(seq);
        if (e.id) out.push({ text: '', emote: e.id, color: null, scope: 'shared' });
      }

      // Our own private state: LP swings, elimination, and the two own-board STATE rules.
      const priv = snap.priv;
      if (priv) {
        if (typeof priv.lp === 'number') {
          if (prev.lp != null && priv.lp < prev.lp) push(out, lineFor('LP_LOSS', { lp: priv.lp, lost: prev.lp - priv.lp, round }, 'self'));
          prev.lp = priv.lp;
        }
        if (priv.alive === false && prev.alive === true) push(out, lineFor('ELIMINATED', { round }, 'self'));
        prev.alive = priv.alive ?? prev.alive;

        // 已急哭: a run of consecutive refreshes that no purchase / merge / shop upgrade has broken. Free refreshes count
        // (`stats.refreshes` counts them too), and a purchase made BEFORE the run is irrelevant — the run restart is set
        // by the COUNTERS, not by a total, so buying early never blocks a later run.
        refreshStreak(out, priv, round);
        // ？！区！？ / ？！区区！？: the player's own board first reaches the bond's tier (炎 6 → 9).
        stateRules(out, 'BOND_COUNT', { round }, 'self', (rule) => bondCountReaches(priv, rule));
      }

      // 吓哭了: ONE operator owned the battle on screen — it out-damaged the field, killed half its monsters, or held one
      // under control. Every number is this client's OWN simulation (createBattleFeatTracker), so the line is SELF by
      // construction: two clients never simulate the same half, which is exactly why nothing here can be shared.
      const feats = snap.battle;
      if (feats) {
        stateRules(out, 'BATTLE_FEAT', {
          round, hp: Math.round(feats.hpTotal), dmg: Math.round(feats.bestDmg),
          kills: feats.bestKills, enemies: feats.enemies, control: Math.round(feats.maxHoldMs / 1000),
        }, 'self', (rule) => battleDominates(feats, rule));
      }

      // The result screen.
      const result = snap.result;
      if (result && result !== prev.result) {
        prev.result = result;
        const win = result.win === true || result.victory === true;
        const finished = win || result.win === false || result.victory === false;
        if (finished) push(out, lineFor(win ? 'RESULT_WIN' : 'RESULT_LOSS', { round }, 'shared'));
      }

      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Live injection (an extensibility hook, not part of the playback loop)
// ---------------------------------------------------------------------------------------------------

/** @type {Set<(text: string, opts?: { color?: string }) => void>} */
const listeners = new Set();

/**
 * Push one comment into every mounted overlay — the hook other client code (or the console) uses to commentate a live
 * event. Ignored when the mod is OFF (nothing is mounted). Returns whether anybody listened.
 * @param {string} text
 * @param {{ color?: string }} [opts]
 */
export function pushDanmaku(text, opts) {
  if (typeof text !== 'string' || !text.trim() || !listeners.size) return false;
  for (const fn of [...listeners]) { try { fn(text, opts); } catch { /* one listener cannot break the others */ } }
  return true;
}

/** The monotonic clock the overlay drives the engine with. */
const nowMs = () => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

/**
 * The scrolling layer. Owns one engine and one director; rebuilt whenever the config object changes.
 * @param {{ config: NonNullable<ReturnType<typeof normalizeDanmaku>> }} props
 */
export function DanmakuOverlay({ config }) {
  const [items, setItems] = useState(/** @type {(DanmakuItem & { seq: number })[]} */ ([]));
  const seqRef = useRef(0);

  useEffect(() => {
    const engine = createDanmakuEngine(config, { viewportRem: viewportRem() });
    const director = createDanmakuDirector(config);
    const tracker = createBattleFeatTracker();
    setItems([]);

    /** @param {DanmakuItem[]} spawned */
    const add = (spawned) => {
      if (!spawned.length) return;
      setItems((prevItems) => {
        const next = [...prevItems, ...spawned.map((s) => ({ ...s, seq: ++seqRef.current }))];
        return next.length > MAX_LIVE ? next.slice(next.length - MAX_LIVE) : next;
      });
    };

    /** Turn the director's lines (and console pushes) into live comments. */
    const emit = (lines) => {
      for (const l of lines) {
        const item = engine.inject(l.emote ? '' : l.text, { color: l.color ?? undefined, emote: l.emote ?? null }, nowMs());
        if (item) add([item]);
      }
    };
    /** The snapshot the director judges: the store's slices, plus the battle feats this client's own sim accumulated. */
    const feed = () => {
      const s = store.get();
      const battle = s.match?.battle;
      emit(director.feed({
        ticker: s.ticker, emotes: s.emotes, pub: s.match?.public ?? null,
        priv: s.match?.private ?? null, result: s.match?.result ?? null, selfId: s.me?.playerId ?? null,
        battle: battle && battle.own ? tracker.feats : null,
      }));
    };
    const unsubscribe = store.subscribe(feed);
    feed(); // seeds the cursors; emits nothing on the first call

    // ---- the local battle (public/js/battle/runner.js) -----------------------------------------------------------
    // The client simulates its own battle, so the runner's public bus carries what the wire does not. `battleRunner`
    // is a browser singleton (null under Node, where the pure half above is what the tests drive) — hence the guards.
    // A LIVE own battle is the one being judged: once it is done the numbers stop moving, and the tick below closes any
    // stretch still open at its last frame (a monster held right up to the whistle counts) BEFORE the next battle's
    // `state` resets the tracker.
    const ownBattle = () => {
      const b = store.get().match?.battle;
      return b && b.own && b.fieldId && !b.done ? b : null;
    };
    const offs = [];
    if (battleRunner?.on) {
      // a new battle resets the numbers; reading a teammate's replica (own: false) leaves ours alone
      offs.push(battleRunner.on('state', (s) => {
        if (!s) { tracker.finish(); tracker.begin(null); return; }
        if (s.own) tracker.begin(s.battleId);
      }));
      offs.push(battleRunner.on('ev', (frame) => {
        if (tracker.feedEv(frame, { selfId: store.get().me?.playerId ?? null })) feed();
      }));
    }

    /** The ambient stream, and — while the player's OWN battle runs — the damage / kill numbers behind BATTLE_FEAT. */
    const tick = () => {
      add(engine.spawn(nowMs()));
      const b = ownBattle();
      if (!b) { if (tracker.finish()) feed(); return; }
      if (!battleRunner?.unitStats) return;
      const samples = [];
      for (const id of tracker.ownUnitIds()) { const u = battleRunner.unitStats(id, b.fieldId); if (u) samples.push(u); }
      if (tracker.observe(samples)) feed();
    };
    tick(); // the first ambient burst appears at once, not one tick later
    const timer = setInterval(tick, SPAWN_TICK_MS);

    const push = (text, opts) => { const item = engine.inject(text, { color: opts?.color }, nowMs()); if (item) add([item]); };
    listeners.add(push);
    return () => {
      clearInterval(timer); unsubscribe(); listeners.delete(push);
      for (const off of offs) { try { off?.(); } catch { /* ignore */ } }
    };
  }, [config]);

  /** A finished comment removes itself (the CSS animation's `animationend`). */
  const drop = (seq) => setItems((prevItems) => prevItems.filter((it) => it.seq !== seq));

  return html`<div class="dmk" aria-hidden="true" style=${{ opacity: config.opacity }}>
    ${items.map((it) => {
      // A text comment sits at its lane's top. An emote is a sticker `emoteRem` tall — taller than a lane — so it is
      // centred on the track instead, bleeding the same amount above and below, and sized from the same number the
      // engine reserved the lane with (so what is drawn and what was timed can never drift apart).
      const box = it.emote
        ? `width:${config.emoteRem}rem;height:${config.emoteRem}rem;top:${it.top + (config.laneHeight - config.emoteRem) / 2}rem;`
        : `top:${it.top}rem;`;
      return html`<span class=${`dmk__item${it.emote ? ' dmk__item--emote' : ''}`} key=${it.seq}
      style=${`${box}font-size:${config.fontSize}rem;animation-duration:${it.durationMs}ms;${it.color ? `color:${it.color}` : ''}`}
      onAnimationEnd=${() => drop(it.seq)}>${it.emote ? html`<${EmoteArt} id=${it.emote} />` : it.text}</span>`;
    })}
  </div>`;
}

/**
 * The global overlay host. Renders nothing at all — not even a container — unless the mod is ON, the current route is
 * one the config names, and the motion preference allows it.
 */
export function DanmakuHost() {
  const settled = useData('danmaku');
  const route = useStore(selectRoute);
  const raw = settled ? data.get('danmaku') : null;
  const config = useMemo(() => normalizeDanmaku(raw), [raw]);
  if (!config || !config.screens.includes(route)) return null;
  if (reducedMotion()) return null;
  return html`<${DanmakuOverlay} config=${config} />`;
}

/**
 * Mount the overlay on its own — the contract a mod's client module has with the FRAMEWORK: the slice names
 * `client: "js/ui/danmaku.js"` (mod/toggles.d/danmaku.json), ui/modBadge.js imports this module while the mod is ON and
 * calls `mount()`, and the returned cleanup unmounts it when the mod goes OFF. main.js never names this module, so the
 * layer lives in its own container appended to <body> rather than inside the App tree (`.dmk` is `position: fixed`,
 * so where the container sits makes no difference).
 * @returns {() => void} the cleanup
 */
export function mount() {
  ensureDanmakuCss();
  const doc = globalThis.document;
  if (!doc || !doc.body) return () => {};             // a headless / pre-body context: mount nothing, never throw
  const host = doc.createElement('div');
  host.className = 'dmk-host';
  host.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(host);
  render(html`<${DanmakuHost} />`, host);
  return () => { try { render(null, host); } catch { /* jsdom / already gone */ } host.remove(); };
}

/** The user's motion preference, when the browser exposes it. */
function reducedMotion() {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { return false; }
}
