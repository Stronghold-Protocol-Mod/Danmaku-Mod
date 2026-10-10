# MOD · 弹幕 (Danmaku)

A **local, unofficial mod** of this checkout — and the **second, independent** one: it lives beside 罗德岛
([MOD-RHODES.md](MOD-RHODES.md)) and the two can be switched on and off separately, in any combination.

It is a **client-side** feature: comments scroll right→left across the screen, video-site style, driven by what actually
happens in the match — a [DanmakuSpire](https://steamcommunity.com/sharedfiles/filedetails/?id=3168980651)-style audience
reacting to the player's play. Three channels feed the layer:

| Channel | Source | Scope |
| --- | --- | --- |
| **Performance** (automatic) | the typed broadcast ticker, the player's own `m.private` / `m.public` deltas, the match result | **self** — only the player's *own* signals react … |
| **Emotes** (player-sent) | `g.emote` → the room-wide `m.emote` push | **shared** — already room-wide |
| **The battle** (automatic) | the client's OWN simulation — [battle/runner.js](../public/js/battle/runner.js)'s public bus | **self** — every client simulates its own field |

> **联防阶段 (`PHASE.UNITE`) is the switch.** Outside it the layer is per-player: each player watches only their own
> performance (`server/sim` calls it 联防; the phase is when a room's boards defend together). Inside it the director
> ingests **every** player's broadcast signal instead, and because the broadcast is deterministic and identical on every
> client, the lines every client derives are the same — **the pool becomes shared**.

## What it is (and is not)

- **Framework first, with exactly five reactions wired in.** The engine is complete — lanes, timings, the event
  director, the emote channel, the in-page switch — and `data/danmaku.json` currently carries **only** the five
  showcase reactions: **卫戍协议，启动！** (every match announces itself, however many players — see §Content),
  **四区兄弟** (the whole room leaked the same round), **已急哭** (seven consecutive shop refreshes
  with nothing bought inside), **？！区！？ / ？！区区！？** (a 炎 board first reaching 6 / 9) and **吓哭了** (one operator
  owned its battle — see §Content). The placeholder ambience and the placeholder broadcast reactions were removed on
  purpose — an empty pool and a ruled-out event are both simply **silent**, so nothing fake can scroll by. Extending it
  is editing data, not code.
- **No free text.** The player-sent channel is the **emote wheel** ([ui/emotes.js](../public/js/ui/emotes.js)): sending an
  emote also drops *that emote* into the stream as a comment. It is **anonymous** — no player name is attached — and there
  is no way to type a line.
- **No protocol change.** Nothing is added to the wire: the performance channel reads frames the client already receives,
  and the emote channel rides the existing `m.emote` broadcast. The one server-side addition is a generic stat
  (`m.private.stats.buys`, see §Known limitations); the in-page switch is generic over the registry.

## Layout

| Path | What it is |
| --- | --- |
| `data/danmaku.json` | the whole mod: the `isMod` presence marker, the playback config, the ambient pool and the rule table |
| `mod/toggles.d/danmaku.json` | the `danmaku` **registry slice** — `files: ["danmaku"]`, marker `danmaku.isMod`, and `client: "js/ui/danmaku.js"` (the framework mounts the overlay through that field, so `main.js` never names this mod) |
| `mod/variants/danmaku/on/danmaku.json` | the state `npm run mod:danmaku` writes |
| `mod/variants/danmaku/off/danmaku.json` | the state `npm run mod:danmaku:strip` writes — the empty object `{}` |
| `tools/local-extract/build-danmaku-mod.mjs` | writes the ON state (its **content constants** are the five authored reactions) |
| `tools/local-extract/strip-danmaku-mod.mjs` | the inverse (a marker drop) |
| `tools/local-extract/lib/strip-danmaku.mjs` | the strip as a pure function — shared by the CLI and the variant builder |
| `public/js/ui/danmaku.js` | the engine + director + overlay (`DanmakuHost`), and the framework's `mount()` entry point |
| `public/css/danmaku.css` | the lane layer and the right→left keyframes |
| `test/content/mod_danmaku.test.js` | the registry, the variants, the switch **and its independence from 罗德岛** |
| `test/ui/danmaku.test.js` | the whole pure half: config, rules, draw, lanes, the director |

## Commands

```bash
npm run mod:danmaku                      # apply (idempotent + byte-deterministic)
npm run mod:danmaku:strip                # remove (leaves `{}`)
node tools/local-extract/build-danmaku-mod.mjs --dry         # report without writing
node tools/local-extract/build-danmaku-mod.mjs --data <dir>  # operate on another data dir
node tools/local-extract/build-mod-variants.mjs --toggle danmaku          # freeze both variants (the switch copies these)
node tools/local-extract/build-mod-variants.mjs --toggle danmaku --check  # verify them
node --test test/content/mod_danmaku.test.js test/ui/danmaku.test.js
```

The in-page 内容开关 (the badge on the title screen — see [MOD-RHODES.md](MOD-RHODES.md) §网页端开关) lists
**both** mods and switches each one independently. Neither the switch engine nor the badge names a mod: the registry is
one file per mod (`mod/toggles.d/<id>.json`) and the overlay is mounted through its own slice's `client` field — so
`public/js/main.js` does not import `DanmakuHost` at all, and 弹幕 can be installed, switched or removed without 罗德岛
being present (and vice versa). The only 弹幕-specific tooling change was giving `build-mod-variants.mjs` a per-toggle
ON→OFF transform (`STRIPS`) instead of hard-coding 罗德岛's.

Together with [MOD-RHODES.md](MOD-RHODES.md) §The framework layer, that is what keeps the two packages **apart**: the
switch machine is one identical framework layer in both, and each mod's own files sit on top of it. 弹幕 brings one
registry slice, its data file and two variants, the client module + its CSS, its two build tools and its docs — plus
**one** author edit of its own, the additive `m.private.stats.buys` in `server/match/player/views.js`
(§Known limitations). 罗德岛 does not touch that file and 弹幕 patches none of 罗德岛's seven, so the two patch sets are
disjoint whatever the install order.

## Content · `data/danmaku.json`

```jsonc
{
  "isMod": true,               // the presence marker the switch reads (OFF = `{}`)
  "version": 1,

  // ---- playback (all lengths are `rem`: 1rem ≈ viewport width / 19.2, so a line crosses in the same number of seconds
  //      at any resolution) ---------------------------------------------------------------------------------------
  "screens": ["title", "lobby", "room", "game"],  // which router screens play it
  "lanes": 12,                 // horizontal tracks (a lane is freed once its comment has fully entered)
  "topPad": 0.34,              // rem from the top of the screen to the first lane
  "fontSize": 0.22,            // rem
  "laneHeight": 0.374,         // rem; default = fontSize × 1.7
  "speed": 2.6,                // rem per second — CONSTANT for every line, so long lines take proportionally longer
  "opacity": 0.88,
  "idleGapMs": 2600,           // the AMBIENT cadence (the reactions are injected, not spawned)
  "idleGapJitterMs": 900,
  "burst": [1, 2],             // ambient comments per burst
  "emoteRem": 0.572,           // the sticker box a danmaku'd emote occupies — 2.6 × fontSize, so it dwarfs a text line

  // ---- ambient pool: filler while nothing is happening. EMPTY for now — an empty pool draws nothing -----------
  "messages": [],

  // ---- performance rules: the in-match reactions ---------------------------------------------------------------
  // Only the five authored reactions live here. An event left out is SILENT, which is currently every BROADCAST
  // event; a broadcast rule would look like the commented line below (see the event table for the placeholders).
  "rules": {
    // "SHOP_LEVEL": { "lines": ["上本了！"], "color": "#6fe3bd" },   // ← the shape of a broadcast reaction

    // ---- the STATE events: conditions, not tickers; each rule fires AT MOST ONCE PER MATCH ----------------
    "MATCH_START":    { "lines": ["卫戍协议，启动！"], "color": "#e8c46a" },   // no condition field — the room size never matters
    "ALL_LEAKED":     { "lines": ["四区兄弟"], "minPlayers": 4 },
    "REFRESH_STREAK": { "lines": ["已急哭"], "refreshes": 7 },
    "BOND_COUNT": [                                            // several rules share one event…
      { "bond": "yanShip", "count": 6, "lines": ["？！区！？"],   "color": "#e8c46a" },
      { "bond": "yanShip", "count": 9, "lines": ["？！区区！？"], "color": "#ff9a9a" }
    ],
    // any ONE of the three measures fires it; a 0 threshold switches that measure off
    "BATTLE_FEAT":    { "lines": ["吓哭了"], "dmgPct": 0.65, "controlSec": 25, "killPct": 0.5 }
  }
}
```

**The events a rule may key off** (`DANMAKU_EVENTS` in `public/js/ui/danmaku.js`). Two families:

*BROADCAST events* — one typed ticker line each (`m.ticker`), scope as noted:

| Event | Fires when | Placeholders |
| --- | --- | --- |
| `SHOP_LEVEL` | a `SHOP_LEVEL` broadcast (调度中心 升级) | `{0}` = the new level, `{round}` |
| `GOLDEN_CHAR` | a `GOLDEN_CHAR` broadcast (精锐晋升) | `{0}`, `{1}` = player / operator, `{round}` |
| `CHAR_GIFT` | a `CHAR_GIFT` broadcast (赠送) | `{0}`, `{1}`, `{round}` |
| `CHAR_DAMAGE` | a `CHAR_DAMAGE` broadcast (单干员伤害达标) | `{0}`…`{2}`, `{round}` |
| `BOSS_HIT` | a `BOSS_HIT` broadcast (领袖 20 / 50 / 80 % 阈值) | `{0}`, `{round}` |
| `BOND_EFFECT` | a `BOND_EFFECT` broadcast (盟约叠层) | `{round}` |
| `UNITE` | the phase **enters** `PHASE.UNITE` (联防阶段) | `{round}` |
| `LP_LOSS` | the player's **own** LP drops | `{lp}`, `{lost}`, `{round}` |
| `ELIMINATED` | the player's **own** life is exhausted | `{round}` |
| `RESULT_WIN` / `RESULT_LOSS` | `m.result` arrives | `{round}` |

*STATE events* — not a broadcast but a condition over the store the director re-reads on every feed. Each rule of one of
these carries its **own condition fields** (the defaults are in `DANMAKU_STATE_DEFAULTS`), and each fires **at most once
per match**. A STATE event may hold **several rules** — write the value as an array of long-form rules (the way
`BOND_COUNT` holds 炎 6 and 炎 9); the ones whose condition holds in turn fire in order.

| Event | Fires when | Fields (default) | Placeholders | Scope |
| --- | --- | --- | --- | --- |
| `MATCH_START` | a **new match** began — this client's view entered one of the opening phases (`MATCH_OPEN_PHASES`). **No player count**: solo announces exactly like a full room | *(none)* | `{round}` | shared |
| `ALL_LEAKED` | **every** player in the room lost LP in the same round (the whole room leaked) | `minPlayers` (4) | `{round}`, `{players}` | shared |
| `REFRESH_STREAK` | `refreshes` **consecutive** shop refreshes (free ones count — `stats.refreshes` includes them) with **no purchase / merge / shop upgrade in between** | `refreshes` (7) | `{round}`, `{refreshes}`, `{streak}` | self |
| `BOND_COUNT` | the player's **own** board first reaches `count` distinct operators of `bond` | `bond` (`yanShip`), `count` (1) | `{round}`, `{bond}`, `{count}` | self |
| `BATTLE_FEAT` | **one** of the player's operators owned the battle on screen — see the notes below | `dmgPct` (0.65), `controlSec` (25), `killPct` (0.5) | `{round}`, `{hp}`, `{dmg}`, `{kills}`, `{enemies}`, `{control}` | self |

Notes on the STATE events:

- **`MATCH_START` (卫戍协议，启动！)** is the only rule with **no condition at all** — it carries no threshold field, so
  there is nothing about the room it could depend on. It is judged on the phase alone: this client watched `m.public.phase`
  leave the lobby (and the previous match's `RESULT`) and land on one of the **opening phases**
  (`MATCH_OPEN_PHASES` = 确认本局信息 / 选择策略 / 协议启动 / 回合开始), which is exactly when a match has just begun.
  Because every player in the room reads the same `m.public.phase`, the line is **shared** — the whole room reads it at
  once. A client whose *first* look at a match is already past the opening (a page reload, a late join, a spectator
  arriving mid-round) stays silent, the same rule the seeding feed applies to every other channel: nothing is replayed
  for a spectator who was not there.
- **A new match re-arms every STATE rule.** The director clears its once-per-match memory and its per-match cursors the
  moment `MATCH_START` fires, so 四区兄弟 / 已急哭 / ？！区！？ / 吓哭了 each get their own run in **every** match of the
  session — not just the first one after the page loaded. The ticker / emote cursors deliberately survive the boundary
  (their ids come from one page-wide counter in `main.js`, so an old id can never return).
- **`REFRESH_STREAK` (已急哭)** counts a *run*, not a total: the run restarts whenever `stats.buys`, `stats.merges` or
  the shop's `level` changes, so a purchase made **before** the run never blocks a later one, but a purchase **inside**
  it does. It needs `m.private.stats.buys` (added to the private view for this mod — see §Known limitations); with no
  such counter the run cannot be trusted and nothing fires.
- **`ALL_LEAKED` (四区兄弟)** is judged when the round's SETTLE opens, from the LP every player lost that round
  (`settle()` has already taken it off while `m.public.round` is still the round just played). Boss rounds pool LP into
  `teamLp`, so they are never judged this way. An eliminated player's LP cannot drop again, so the rule naturally needs
  everyone still alive — `minPlayers` guards the room size.
- **`BOND_COUNT` (？！区！？ / ？！区区！？)** reads `m.private.bonds[].count`, which is the **distinct members on the
  board** (`countMode: BOARD`), i.e. 在场不同【炎】干员数 — exactly the 6 / 9 the 炎 covenant's tiers name.
- **`BATTLE_FEAT` (吓哭了)** is the one rule fed by the **battle itself**. The client simulates its own battle
  ([battle/runner.js](../public/js/battle/runner.js), its public bus), so the numbers come from that simulation and are
  **local to this client** — never the shared pool. One operator owning the fight by *any* of three measures fires it:
  - **damage** — it dealt `dmgPct` of every monster's HP. The denominator is **every monster that spawned** in the field
    (summons, splits and leader parts included — the `['spawn', UnitInfo]` stream, summed by `maxHp`);
  - **kills** — it killed `killPct` of the monsters that spawned (the same denominator, counted);
  - **control** — one monster stood under a control status for `controlSec`. `DANMAKU_CONTROL_STATUSES`
    (`stun` / `freeze` / `sleep` / `bind` / `cold`) is the set, and 寒冷 counts because it is what 谢拉格不融冰 lands
    (12 % per attack of 1.5 s of 寒冷; the 谢拉格 pair turns a cold into 冻结).
  A 0 threshold switches a measure off, so a rule can be narrowed to one kind of showing-off. The damage and kill
  numbers are read from the runner's live per-unit accessor (`battleRunner.unitStats`), the same numbers the detail card
  shows, so the line lands **while the battle runs** rather than at its end.

`{0}`, `{1}`, … are the official broadcast's own params (`m.ticker.args`); `{round}`, `{lp}`, `{lost}` come from the
snapshot. A key that has no value is left **verbatim** in the line, so a typo is visible rather than silently blank.
An event with no rule is simply silent — that is how a line is switched off without touching code.

## Contributing a line

**You do not need to write code.** Open a
[danmaku submission issue](https://github.com/Stronghold-Protocol-Mod/Danmaku-Mod/issues/new?template=DanmakuSubmission.yml)
— trigger, line, colour — and a maintainer turns it into a rule. The form is in Chinese; the vocabulary it asks you to
choose from is the two event tables in §Content above. One issue per line, so each one can be discussed and merged on
its own. (That repository is where this mod is distributed; this copy of the doc ships inside the game, so the link
points at the mod's own repo rather than relative to here.)

With code it is a data change. A reaction is one entry in the `rules` table of `data/danmaku.json`: this checkout
**generates** that file from the `RULES` constant of
[tools/local-extract/build-danmaku-mod.mjs](../tools/local-extract/build-danmaku-mod.mjs), so edit the constant and
rebuild. In the mod's own repository the payload's `data/danmaku.json` is the source of truth and is edited directly
(no build step) — this checkout generates it, so rebuild here:

```bash
npm run mod:danmaku        # regenerate data/danmaku.json from the constants
npm run mod:variants       # refresh mod/variants/danmaku/{on,off}
node --test test/content/mod_danmaku.test.js test/ui/danmaku.test.js
```

A rule keyed on an **existing** event is that much and no more. A **new kind** of trigger is code, not data: the event
has to exist in `DANMAKU_EVENTS` / `DANMAKU_STATE_EVENTS` ([public/js/ui/danmaku.js](../public/js/ui/danmaku.js)), a
STATE event needs its default thresholds in `DANMAKU_STATE_DEFAULTS`, and the director needs the branch that judges it —
open an issue to talk it over before writing one. Either way add a case to `test/ui/danmaku.test.js`: one that fires and
one that does not.

## How it works

```
m.ticker / m.private / m.emote / m.result  ──►  director (rules)  ──►  engine (lanes)  ──►  spans + CSS keyframes
        (frames the client already has)          data-driven            rem arithmetic         right→left march
battleRunner 'ev' / 'result'  ──►  battle-feat tracker  ──────────────┘   (the local sim: monster HP, control time,
   (the client's OWN simulation)      (createBattleFeatTracker)            this player's units' damage / kills)
```

- **The director** (`createDanmakuDirector`) consumes a store snapshot and returns the reaction lines due: **one per
  matched event**, never a backlog, never the same event twice. Its first feed only **seeds** its cursors — the store
  already holds the tail of the ticker stream, and replaying it would open the layer with reactions to things that
  happened before the overlay existed. The one transition it treats as a **boundary** is `MATCH_START`: there it drops
  its once-per-match memory (and the cursors that compare against the previous match's LP / round / counters), which is
  what makes every STATE rule fire once in **each** match rather than once per page load.
- **The battle-feat tracker** (`createBattleFeatTracker`) is the one input that is not a store slice: the battle the
  client simulates itself publishes through the runner's bus, and this pure accumulator turns it into the four numbers
  `BATTLE_FEAT` is judged from — `hpTotal` / `enemies` from the `['spawn', …]` stream, `maxHoldMs` from the `['status', …]`
  edges, `bestDmg` / `bestKills` from the live `battleRunner.unitStats`. Nothing in it is shared: two clients never
  simulate the same half, which is exactly why these lines can never join the shared pool.
- **The engine** (`createDanmakuEngine`) is pure arithmetic over `rem`. A lane freed once its comment has fully entered
  (`ownWidth / speed` seconds); a comment lives until its nose clears the left edge (`(viewport + width) / speed`), which
  is exactly what the CSS animation is timed for. A burst only ever fills **free** lanes, so two comments can never
  overlap inside one lane.
- **The overlay** renders each comment as an absolutely-positioned span whose `animation-duration` is the engine's
  number, removes it on `animationend`, and drops the whole layer under `prefers-reduced-motion`.

## Known limitations (the framework's edges)

- **The ambience and the broadcast reactions are empty for now.** `messages` is `[]` and no BROADCAST event has a rule
  (see §Content above) — an empty pool and an un-ruled event are both **silent**, so only the five STATE reactions and
  the emote channel ever draw. Writing them back in is editing `data/danmaku.json` (or the `AMBIENT` / `RULES` constants
  in `build-danmaku-mod.mjs`, then `npm run mod:danmaku`). The doc tables above are the whole vocabulary; a new *kind* of
  trigger is a code change.
- **One small core addition: `m.private.stats.buys`.** `REFRESH_STREAK` needs to know whether a purchase happened inside
  a run, and the game already counts purchases (`PlayerState.stats.buys`) but did not publish it. It now rides the private
  stats beside `refreshes` / `merges` (`server/match/player/views.js`). It is a generic, additive field — every client
  gets it whether the mod is ON or OFF — and it is the only change outside `data/danmaku.json`, the client module, the
  build tools and the tests. The mod is otherwise still driven entirely by its one data file.
- **`BATTLE_FEAT` is the one rule that reads the LOCAL battle** ([battle/runner.js](../public/js/battle/runner.js)) —
  the client simulates its own field, so its public bus is the source. It is therefore **self only** (two clients never
  simulate the same half) and it can never see a teammate's showing-off. Two of its three measures have honest edges:
  - **Control is timed on the MONSTER, not the operator.** The event stream ships `['status', unitId, key, 1|0]` — the
    edge, with **no source** — so a stretch cannot be attributed to whoever applied it. What fires is "a monster stood
    under control for N s", which in practice is the 谢拉格 / 不融冰 lock-down this rule exists for. Blaming a specific
    operator would need a per-unit counter inside the sim (`server/sim`), i.e. a protocol addition the mod avoids.
  - **The denominators count EVERY monster that spawned** (summons, splits and leader parts included): a field that
    summons heavily raises the bar for both the damage share and the kill share. The per-operator numbers themselves are
    read live from `battleRunner.unitStats` — the accessor the detail card already uses — so the line lands **during** the
    battle, not at its result.
- **A `REFRESH_STREAK` run is broken by anything the economy counters see** — a purchase, a merge, a shop upgrade. Placing
  or benching a unit, freezing the shop and the like are not counted by the game either, so they do not break a run.
- **Emotes render as their picture**, in a sticker box `emoteRem` in size (2.6 × the font, so a sticker several line
  heights tall, centred on its lane), with the label as the accessible name — the official emotes are picture-only
  (ui/emotes.js). The overlay sizes the box from the same number the engine reserved the lane with, so a bigger sticker
  is spaced and timed correctly; `emoteRem` is the one knob.
- **`prefers-reduced-motion` disables the layer entirely** (host and CSS both refuse). That is deliberate.
- **Shared means "derived from the same broadcast".** During 联防 every client draws from the identical ticker + `m.emote`
  stream, so the pools match without a protocol. A signal only one client can see (the local battle's internals) is
  therefore never part of the shared pool. `ALL_LEAKED` is the same idea one level up: it is derived from `m.public`, which
  every client holds, so all screens show 四区兄弟 at once without any new message.

## Tests

- `test/content/mod_danmaku.test.js` — the registry entry (its `files` are exactly the one file, its marker is
  `danmaku.isMod`), both frozen variants (ON carries the marker, OFF is `{}`, stripping ON reproduces OFF byte for byte,
  the checkout mirrors its own state), the switch itself on a throwaway directory — and the **independence property**:
  a 弹幕 switch leaves all six 罗德岛 files byte-identical, a 罗德岛 switch leaves `danmaku.json` untouched, and their file
  sets are disjoint. Also the fresh-checkout case (no file at all = OFF).
- `test/ui/danmaku.test.js` — the pure half: the config normaliser (every field clamped, a bare `{isMod:true}` is a valid
  but silent framework, the emote sticker box), the rule table (long/short form, an array of rules, the STATE condition
  defaults and overrides, unknown events dropped), the weighted draw, the width estimate, the template filler, the
  lane/timing engine (cadence, lane reuse, no same-lane overlap, emote injection), the **battle-feat tracker** (monster HP
  and count off the spawn stream, control timed per monster with overlapping statuses folded into one stretch, a kill /
  leak closing it, `finish()` closing what is still open, the live per-unit fold, a new battle resetting), and the director
  (seed-on-first-feed, **self outside 联防 / shared inside it**, the phase switch announcing once, per-event
  de-duplication, placeholders, emotes, LP / elimination / result) — plus the five STATE rules end to end: 卫戍协议，启动！
  on the opening phase of **every** match whatever its player count (and never for a client that arrives after it), the
  per-match memory being re-armed at that boundary, 四区兄弟 only when the whole room settles with lost LP, 已急哭 on the
  seventh consecutive unbroken refresh (and not across a purchase / merge / upgrade), ？！区！？ / ？！区区！？ on the board
  first reaching 6 / 9 炎, and 吓哭了 on any one of the three BATTLE_FEAT measures (and not on a measure switched off with
  a 0 threshold).
- `test/match/economy.test.js` — `stats.buys` counts a purchase and a **free** refresh still counts as a refresh.
