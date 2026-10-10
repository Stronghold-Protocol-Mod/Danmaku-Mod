# 弹幕 MOD · 卫戍协议：盟约

《卫戍协议：盟约 · Stronghold Protocol》的**非官方本地 MOD**：在官方 **0.2.3** 之上加一层**弹幕** —— 视频网站那样从右往左滚过屏幕的吐槽，由对局里真实发生的事情驱动。装完即用，随时可开可关。

![version](https://img.shields.io/badge/version-1.0.0-2ea44f)
![base](https://img.shields.io/badge/base%20game-0.2.3-blue)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

## 声明

> [!IMPORTANT]
> - 本 MOD 是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，未获其授权或认可。
> - 本 MOD 是基于 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的第三方二次创作，**与上游项目的作者无隶属关系**，也未获其背书。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本 MOD 自己编写的代码。
> - 仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。
> - 本仓库**不包含**上游项目的源码：上游的文件以**补丁**的形式携带，安装时打在你自己那份官方安装上。本仓库也不含任何游戏素材。完整条款见 [NOTICE.md](NOTICE.md)。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本 MOD 按「现状」提供，**不提供任何担保**，使用风险自负。

## 目录

- [声明](#声明) · [简介](#简介)
- [弹幕一览](#弹幕一览) · [投稿](#投稿)
- [安装](#安装) · [开关](#开关) · [卸载](#卸载)
- [与其他 MOD 共存](#与其他-mod-共存)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献)

## 简介

弹幕 MOD 在游戏的**客户端**上挂一层弹幕。它对游戏逻辑本身只做**读**：翻的是一局里本来就在客户端手上流转的那些数据，再按一张**规则表**决定"什么时候该飘什么"。

- **纯客户端**。服务器只多了一件小事：注册表里多一个开关（`GET /mod/state`、`POST /mod/toggle`），以及一个 `m.private.stats.buys` 字段（`REFRESH_STREAK` 判定"这七次刷新中间买过东西没有"要用）。没有任何新协议、新消息。
- **数据驱动**。弹幕内容全是 `data/danmaku.json` 里的一张规则表 —— 加一条吐槽不用改代码（见[投稿](#投稿)）。
- **MOD 关闭时游戏就是原版**：`data/danmaku.json` 切回空对象 `{}`，那一层 JS 便什么都不做。

组成一览：

- **5 条自设弹幕**（见下表）＋ **表情弹幕通道**（玩家发表情时，那个表情也会作为一条弹幕飘过）。
- **12 条横向泳道**，从右往左匀速滚过（速度恒定，所以长句子走得久，符合弹幕站的习惯）。
- **开关引擎**：`GET /mod/state` 读状态、`POST /mod/toggle` 切换，标题界面另有一个可点的状态徽标。
- **零美术素材**：表情用的是官方 emotes，弹幕是纯文字 + CSS 动画。

### 对官方文件的改动

MOD 自身文件放在 `payload/`，原样复制进游戏目录；对官方文件的改动以补丁携带（**不搬运源码**）：

| 形式 | 数量 | 说明 |
| --- | --- | --- |
| `payload/` | 11 个文件 / 约 104 KB | 弹幕本体、数据、开关框架 |
| `patches/*.diff` | 12 个文件 / 21 个 hunk / +118 −8 | 多数是**加挂点**性质：注册开关、转发两条路由、在 `main.js` 里挂上弹幕层 |

关掉 MOD 后这些代码不生效。

<details>
<summary>被改动的 12 个官方文件</summary>

```
package.json                          三个 npm 脚本（mod:danmaku / :strip / :status）
public/index.html                     引入 danmaku.css
public/js/main.js                     挂载弹幕层、广播带上 args、接入开关
public/js/screens/title.js            标题界面挂 MOD 徽标
public/css/screens/title.css          徽标样式
public/js/store.js                    store 里多一个 mod 切片
server/index.js                       Lobby 改从活数据读取（开关立即生效）
server/http/routes.js                 转发 /mod/*
server/http/websocket.js              createSessionStack 接受活数据 getter
server/lobby.js                       modChanged() 广播开关变化
server/match/player/views.js          m.private.stats 增加 buys
shared/protocol.js                    S2C 增加 'mod.state'
```

</details>

### 仓库结构

```
install.bat / install.sh      一键安装（双击 / 把游戏文件夹拖上来）
payload/                      MOD 自有文件，原样复制进游戏目录
  ├─ data/danmaku.json        规则表 —— 弹幕内容全在这里（可直接手改）
  ├─ docs/MOD-DANMAKU.md      详细文档（随 MOD 一并装入游戏）
  ├─ mod/                     开关清单 + ON/OFF 数据快照
  ├─ public/                  弹幕引擎 + 横滚 CSS
  └─ server/                  开关框架（路由、切换、活数据）
patches/                      对官方文件的补丁（12 个 .diff）
tools/
  ├─ install.mjs              安装器（--check / --off / --restore / --force / --game）
  ├─ mod-toggle.mjs           开关 CLI（on / off / status）
  ├─ game-root.mjs            定位游戏目录
  ├─ diff.mjs                 纯 JS 的 unified diff 生成 / 应用
  ├─ manifest.mjs             重新计算哈希（改了 payload 之后跑一下）
  └─ manifest.json            全部文件的哈希与补丁元数据
```

## 弹幕一览

| 弹幕 | 类型 | 什么时候发 |
| --- | --- | --- |
| **卫戍协议，启动！** | 开局 | 每一局开始时发一次，**与人数无关**（单人局和四人局一模一样） |
| **四区兄弟** | 全房间漏怪 | **同一回合里每位玩家都掉血**（整间房一起漏），`minPlayers` 默认 4 |
| **已急哭** | 连续刷新 | **连续 7 次刷新商店**，且这七次中间**没买过任何东西**（免费刷新也算一次） |
| **？！区！？** | 盟约 | 自己场上**第一次凑齐 6 名不同的【炎】干员** |
| **？！区区！？** | 盟约 | 同上，**9 名** |
| **吓哭了** | 单干员主宰战场 | 同一位干员用**任意一种**方式主宰了这场作战：打出全部刷出怪血量 **65%** 的伤害 / 对同一只怪持续控制 **25 秒** / 击杀本回合 **50%** 的敌人 |
| *（表情弹幕）* | 玩家发表情 | 用表情轮盘发表情时，那个表情会作为一条弹幕飘过（全房间可见，匿名） |

> **作用域**：除「四区兄弟」和「卫戍协议，启动！」是按全房间公共状态判定（四个屏同时出现）外，其余都是**只对自己发** —— 你干的事，你自己屏幕上飘。
> 每条弹幕**每局至多发一次**，下一局重新武装。

## 投稿

**这个 MOD 的内容是给玩家投稿的。** 一条弹幕就是一条规则，加一条不需要会写代码。

### 方式一：开 Issue（推荐，不用会写代码）

用 **[弹幕投稿表单](https://github.com/Stronghold-Protocol-Mod/Danmaku-Mod/issues/new?template=DanmakuSubmission.yml)** 填一张表：投稿类型（新反应类型 / 新文案 / 调阈值 / 常驻池）、触发时机、文案、颜色。维护者会把它落成规则。

> 一张 Issue 只投稿一条。

### 方式二：直接改数据，提 Pull Request

`payload/data/danmaku.json` **就是内容本身，可以直接手改**（不经过任何构建步骤）。一条规则长这样：

```jsonc
{
  "MATCH_START":    { "lines": ["卫戍协议，启动！"], "color": "#e8c46a" },
  "ALL_LEAKED":     { "lines": ["四区兄弟"], "minPlayers": 4 },
  "REFRESH_STREAK": { "lines": ["已急哭"], "refreshes": 7 },
  "BOND_COUNT": [                                             // 一个事件可以挂好几条规则
    { "bond": "yanShip", "count": 6, "lines": ["？！区！？"],   "color": "#e8c46a" },
    { "bond": "yanShip", "count": 9, "lines": ["？！区区！？"], "color": "#ff9a9a" }
  ],
  "BATTLE_FEAT":    { "lines": ["吓哭了"], "dmgPct": 0.65, "controlSec": 25, "killPct": 0.5 }
}
```

能对什么发、能读到哪些数据，全在
**[payload/docs/MOD-DANMAKU.md 的 §Content](payload/docs/MOD-DANMAKU.md)** 的两张事件表里：

- **播报事件**（`m.ticker` 的一行）—— 比如 `SHOP_LEVEL`（升级调度中心）、`GOLDEN_CHAR`（精锐晋升）、`BOSS_HIT`（领袖掉到 20/50/80%）。
  这些**目前都还没写规则**，也就是处于「静音」状态 —— 想加随时投稿。
- **条件事件**（导演每次收到数据都重新判断一次）—— 比如 `BOND_COUNT`（某盟约凑到几个不同干员）、`BATTLE_FEAT`（单干员主宰战场）。
- **常驻池**：`messages` 现在是空的。不想让它空着，就把想随机飘的句子填进去。

改完运行：

```bash
node tools/manifest.mjs      # 刷新 payload 的 SHA-256（改了 payload 就必须跑）
node tools/install.mjs --check --game <你的游戏目录>
```

`{round}`、`{0}`、`{1}` 这类占位符会从对局数据里填；**填不出来的键会原样留在文字里**（所以打错字一眼能看见，不会静默变空）。

## 安装

|  |  |
| --- | --- |
| **适配版本** | 官方 **0.2.3**（`package.json` → `"stronghold-protocol-alliance"` / `"0.2.3"`） |
| **前置要求** | 已装好并能正常启动的官方游戏本体；**Node.js 22 或 24 LTS**（游戏本身也依赖它） |
| **体积** | 下载的 ZIP 约 40 KB，解压后约 500 KB |
| **平台** | Windows（`install.bat`）· macOS / Linux（`install.sh`） |

> 官方 0.2.3 之外的其他版本**未必能直接装**：安装器会先把每个补丁试打一遍，打不上就**报错并停止**，不会把游戏改坏。届时等 MOD 跟进即可。

### 步骤

1. 从 [Releases](https://github.com/Stronghold-Protocol-Mod/Danmaku-Mod/releases) 下载 `danmaku-mod-<版本>.zip`（或 `Code` → `Download ZIP`），解压到**游戏目录里面**（推荐 —— 这样终端里的开关脚本也在正确位置）。
2. 双击 **`install.bat`**。

就这样，安装器会自己找到游戏目录。如果你把 MOD 解压到了别的地方，有两条退路：

- 把**游戏文件夹直接拖到 `install.bat` 上**松手；
- 命令行里指定：`install.bat "D:\你的路径\Stronghold-Protocol"`。

macOS / Linux 用 `./install.sh`，参数一样。

### 安装器做了什么

按顺序四件事，**任何一步对不上就在动文件之前停下**：

0. **预检**：把 12 个补丁全部试打一遍。有打不上的（最常见：这份游戏上已经装了别的 MOD）就整体放弃，**一个文件都不动**。
1. 把 MOD 的 **11 个自有文件**放进游戏目录（已是最新的会跳过）；`mod/toggles.json` 走**合并** —— 只加自己那一条，不动别的 MOD 已登记的开关。
2. 给官方文件打 **12 个补丁**（逐文件校验 SHA-256，结果对不上就报错）。
3. 把 MOD **打开**。

装之前，会被改动的官方文件会先备份到 `<游戏目录>/.danmaku-mod-backup/<时间戳>/`。

装完正常启动游戏（`npm start`，或你平时用的启动方式）即可，标题界面上会多一个 MOD 状态徽标。

安装器还支持几个开关：`--check`（只校验不写入）、`--off`（装完保持关闭）、`--restore`（从备份还原官方文件）、`--force`（跳过版本校验）。

## 开关

MOD 是**数据驱动**的：那套 JavaScript 永远随游戏加载，但**只有数据存在时才工作**。开关做的事情，就是在 `data/danmaku.json` 的「ON 快照」和「OFF 快照」之间切换 —— **OFF 快照就是 `{}`**，所以关掉之后那条弹幕层彻底静音。

三种开关方式，随你顺手：

```bat
:: 命令行（在游戏目录里；MOD 解压到别处就换下面第三条）
npm run mod:danmaku            :: 开
npm run mod:danmaku:strip      :: 关
npm run mod:danmaku:status     :: 看状态
```

- **游戏内（推荐，不用终端）**：标题界面的 MOD 徽标，点一下切换（仅本机回环地址可切，对局进行中禁止切换）。
- **HTTP**：`POST /mod/toggle?id=danmaku&on=1`（`0` 为关闭），`GET /mod/state` 读状态。
- **MOD 目录里**：`node tools/mod-toggle.mjs on|off|status --game <游戏目录>`，任何解压位置都能用。

反复开关是幂等的 —— 开 → 关 → 开之后，数据文件与第一次开时**逐字节一致**。

## 卸载

```bat
npm run mod:danmaku:strip
:: 或从 MOD 目录：node tools/mod-toggle.mjs off --game <游戏目录>
```

游戏就回到原版了。想彻底清理，再删掉这些 MOD 新增的文件 / 目录：

- `data/danmaku.json`、`mod/`、`docs/MOD-DANMAKU.md`
- `public/js/ui/danmaku.js`、`public/js/ui/modBadge.js`、`public/css/danmaku.css`
- `server/mod/`、`server/sim/content/kits/mod.js`
- `tools/{install,mod-toggle,game-root,diff,manifest}.mjs`、`tools/manifest.json`
- `install.bat` / `install.sh`（如果你把仓库文件放在了游戏目录里）

那 12 个被打了补丁的官方文件，用 `.danmaku-mod-backup/<时间戳>/` 里的备份覆盖回去即可
（或直接跑 `node tools/install.mjs --restore --game <游戏目录>`）。
`tools/manifest.json` 记录了每个文件的 `baseSha256` / `resultSha256`，可以自行核对。

## 与其他 MOD 共存

> [!WARNING]
> **本 MOD 目前不能和 [罗德岛 MOD](https://github.com/Stronghold-Protocol-Mod/Rhodes-Mod) 装在同一份游戏上。**

两个 MOD 都会改 `public/js/main.js` 和 `package.json`，而且改的是**同一个位置**（导入区、脚本区），补丁的上下文对不上。

好消息是**失败是安全的**：安装器的第 0 步预检会先试打一遍，打不上就整体放弃，报出是哪两个文件、**一个文件都不动**：

```
== 0/3  预检失败 ==
× 有 2 个官方文件打不上补丁，**没有改动任何文件**：
   · public/js/main.js: hunk @@ -35 @@ does not apply: context not found …
   · package.json: hunk @@ -30 @@ does not apply: context not found …
```

其余 10 个补丁（开关框架那套）两个 MOD 改得**逐字节相同**，所以装在一起时会互相识别成"已打过"而跳过。

**目前的做法**：想要两个 MOD 就准备两份游戏目录，各装一个。

（如果你希望它们能装在一起，欢迎在 Issue 里说一声 —— 把 `main.js` / `package.json` 的两个补丁从「上下文补丁」改成「按锚点插入」就能共存。）

## 许可证

- **代码**：本 MOD 自己编写的代码与文档，以及随附的补丁片段，以 **GPL-3.0-or-later** 发布（与上游一致，因为它是上游作品的衍生），全文见 [LICENSE](LICENSE)；另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等版权归原权利人所有，不适用 GPL。本仓库不分发任何素材（弹幕用的是官方 emotes，随游戏本体一起加载）。
- **上游项目**：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)，同为 GPL-3.0-or-later。

## 致谢与数据来源

- **上游项目**：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) —— 本 MOD 完全寄生在它之上，没有这个项目就没有这个 MOD。
- **灵感**：DanmakuSpire 那类"观众看你在打什么"的弹幕层；「四区兄弟」「已急哭」这些说法来自玩家社区的播报梗。盟约与技能数值口径核对来源为 [PRTS Wiki](https://torappu.prts.wiki/)。
- **素材版权**：《明日方舟》及其全部角色、美术、Spine 模型、界面图、音乐音效、文本与数据，版权归上海鹰角网络科技有限公司及其授权方（Yostar 等）所有。
- **第三方许可**：上游 `NOTICE.md` 列出的全部贡献者与组件（PixiJS、pixi-spine、Preact、htm、three.js、ws、isHarryh/Ark-Unpacker 等）同样适用于本 MOD 运行所在的这份游戏。

## 贡献

欢迎提 Issue 投稿弹幕（见[投稿](#投稿)）、反馈 bug 或提改进建议，也欢迎提交 Pull Request：

- **改 `payload/data/danmaku.json` 之后一定要跑 `node tools/manifest.mjs`**，否则安装器的哈希校验会失败。
- 开关必须保持**往返幂等**（`strip → rebuild` 后与 ON 快照逐字节相同）。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

> 本 MOD 仓库：<https://github.com/Stronghold-Protocol-Mod/Danmaku-Mod>　·　兄弟 MOD：<https://github.com/Stronghold-Protocol-Mod/Rhodes-Mod>　·　上游项目：<https://github.com/sganggs/Stronghold-Protocol>

