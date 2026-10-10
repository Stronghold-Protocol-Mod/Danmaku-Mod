# 版权与使用声明（NOTICE）

本仓库是 **《卫戍协议：盟约 · Stronghold Protocol》的第三方 MOD**，名称为「弹幕 MOD」。

《卫戍协议：盟约 · Stronghold Protocol》本身是《明日方舟》限时玩法「卫戍协议：盟约」的**非官方同人复刻**，
与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关联**，也未获得其授权或认可。
本 MOD 同样与上述各方**没有任何关联**，未获其授权或认可。

- 上游项目：<https://github.com/sganggs/Stronghold-Protocol>
- 本 MOD：<https://github.com/Stronghold-Protocol-Mod/Danmaku-Mod>

---

## 1. 本仓库分发的是什么

本仓库**不包含上游项目的源码**，也**不包含任何游戏素材**。上游文件以**补丁**的形式携带
—— `patches/*.diff`，对上游 12 个文件的统一 diff。

安装时（`tools/install.mjs`）把它们打在用户自己那份官方安装上，并在落地前逐个文件校验
`baseSha256` / `resultSha256`（见 `tools/manifest.json`），对不上即报错停止。

因此本仓库中的补丁文件是**上游 GPL 代码的衍生片段**，随上游一同以 GPL-3.0-or-later 发布。

`payload/` 下是 MOD 自己新增的文件（弹幕引擎、规则数据、开关框架、文档）。

## 2. 代码许可证：GPL-3.0-or-later

Copyright (C) 2026 弹幕 MOD contributors

本 MOD 自己编写的源代码与文档文字，以及上述补丁片段，以
**GNU 通用公共许可证第 3 版或（由你选择）任何更新版本**（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。

作为上游作品的衍生，这是必须的 —— 上游同样是 GPL-3.0-or-later。你可以依该许可证使用、修改和再分发。

**附加许可（GPL-3.0 第 7 条）** — Additional permission under GNU GPL version 3 section 7:

> If you modify this Program, or any covered work, by linking or combining it with the Spine Runtimes (as shipped in
> pixi-spine, or a modified version of them), containing parts covered by the terms of the Spine Runtimes License
> Agreement, the licensors of this Program grant you additional permission to convey the resulting work.
> Corresponding Source for a non-source form of such a combination shall include the source code for the parts of the
> Spine Runtimes used as well as that of the covered work.

（大意：允许把本项目与 pixi-spine 中的 Spine Runtimes 组合后再分发；Spine Runtimes 本身仍受其自己的许可证约束。
本附加许可沿用自上游 NOTICE。）

## 3. 不属于本项目、不受 GPL 约束的内容

《明日方舟》及「卫戍协议」相关的全部**名称、角色、美术、Spine 模型、界面图、音乐音效、文本与游戏数据**，
版权归上海鹰角网络科技有限公司及其授权方（Yostar 等）所有。

**本仓库不分发任何这类内容。** 弹幕层是纯文字与 CSS 动画；表情弹幕走的是**游戏本体已经加载的官方 emotes**
（`public/js/ui/emotes.js` 引用的那套图），本 MOD 不额外携带素材文件。

弹幕文案由社区投稿（见 README 的「投稿」一节），是玩家自己写的话，不含官方剧情或技能文本的原文引用。

## 4. 免责

本 MOD 仅供**个人学习与技术研究**使用，不得用于任何商业用途。
使用者应自行承担使用风险；因使用本 MOD 造成的任何直接或间接损失，作者不承担责任。
若相关权利人认为本 MOD 侵犯了其权益，请联系作者，作者将立即下架相关内容。

## 5. 致谢

- **sganggs/Stronghold-Protocol** —— 上游项目的作者与贡献者。没有这个项目，就没有这个 MOD。
- 上游 `NOTICE.md` 中列出的全部贡献者与第三方许可（PixiJS、pixi-spine、Preact、htm、three.js、ws、
  isHarryh/Ark-Unpacker 等）。
- 弹幕梗与播报说法来自玩家社区；数值口径的核对来源：[PRTS Wiki](https://torappu.prts.wiki/)。
