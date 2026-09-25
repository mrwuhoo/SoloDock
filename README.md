<div align="center">
<img src="build/solodock-icon.png" width="120" alt="SoloDock Logo" />
<h1>SoloDock</h1>
<p><strong>一人公司的桌面效率工作台。</strong></p>
<p>待办、笔记、专注计时、链接、录音与 AI 完成提醒，收进一个磨砂玻璃面板。</p>
<p><a href="https://github.com/mrwuhoo/SoloDock">GitHub</a> · <a href="https://github.com/mrwuhoo/SoloDock/issues">反馈</a> · <a href="CHANGELOG.md">更新日志</a> · <a href="LICENSE">MIT</a></p>
</div>

> 基于 [xiaopu-ai/TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) v1.1.2 开发，由 mrwuhoo 独立维护。不是上游官方发行版，保留原版权与 MIT 授权，详见 [NOTICE.md](NOTICE.md)。

## 当前状态

当前版本 **0.1.0**。安装包和校验文件见 [GitHub Release](https://github.com/mrwuhoo/SoloDock/releases/tag/v0.1.0)。

| 平台 | 安装包 |
| --- | --- |
| macOS 13+ Apple Silicon | [SoloDock-0.1.0-arm64.dmg](https://github.com/mrwuhoo/SoloDock/releases/download/v0.1.0/SoloDock-0.1.0-arm64.dmg) |
| Windows 10/11 x64 | [SoloDock-0.1.0-windows-x64-setup.exe](https://github.com/mrwuhoo/SoloDock/releases/download/v0.1.0/SoloDock-0.1.0-windows-x64-setup.exe) |

同一 Release 提供各安装包的 SHA-256。Mac 打开 DMG 后将 SoloDock 拖入应用程序；Windows 运行安装向导。macOS 安装包没有 Apple Developer ID 公证，Windows 安装包未作商业签名，系统可能提示确认来源。不要关闭系统整体安全保护。

- macOS 13+ Apple Silicon：本地开发与验证的主要平台。
- Windows 10/11 x64：继承上游兼容代码和构建配置，通过 Windows CI 的安装、启动、重装数据保留与卸载验证；实体设备仍待补充验收。
- UI：浅蓝磨砂玻璃、透明外壳、柔和圆角与卡片。

## 开发中：AI 用量（多订阅）

首页「AI 用量」最多同时显示 3 个订阅（设置 → AI 用量 → 订阅，可开关、排序、填写套餐和每月续费日）：

- **Codex**：自动读取本机登录账号的额度与重置卡（见下文）。
- **Claude**：通过 Claude Code 状态栏上报。在设置里点「复制接入设置」，把复制到的 `statusLine` 配置粘贴进 `~/.claude/settings.json` 并重启 Claude Code。脚本 `scripts/claude-statusline.js` 只把 `rate_limits` 里 5 小时与每周窗口的已用百分比和重置时间转发到本机 `127.0.0.1:43821/usage/claude`，会话、路径、模型等内容不会离开 Claude Code；数据只保存在内存里。已有自己的状态栏命令时，用 `--then '原命令'` 接在后面，状态栏继续显示原来的内容。仅 Pro/Max 订阅会提供该数据。
- **其他订阅**（如 Grok）：没有可读取的额度接口，只显示套餐和续费倒计时，不会显示猜测的额度。

## 接入 Claude Code 提醒

在 `~/.claude/settings.json` 的 `hooks` 里登记 SoloDock 的转发脚本（把路径换成你的 SoloDock 目录）。`Stop` 在一轮任务完成时提醒；`Notification` 在 Claude Code 请求权限时点亮刘海下沿的「Claude 需要你确认」并弹出提醒，你批准后它继续工作、完成时状态自动清除。脚本只转发标题、项目名与权限提示，不上传对话内容，只发往本机 `127.0.0.1:43821`。

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/to/SoloDock/scripts/claude-notify.js" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node /path/to/SoloDock/scripts/claude-notify.js" }] }]
  }
}
```

## 开发中：Codex 用量

当前源码在首页新增「订阅用量」卡片（尚未包含在 v0.1.0 安装包中），不占用独立导航。支持与其他卡片相同的长按拖动排序和迷你 / 小 / 中 / 大尺寸切换；可见组件达到七个时，即使另一个组件隐藏，仍可调整尺寸。可见组件少于七个时沿用首页自动填充布局。旧版七卡片的相对顺序会保留，新卡片加入后重新分配网格空间。

在「设置 → 首页 → 首页组件」开关订阅用量；卡片齿轮跳转到「设置 → 订阅配置」。点击连接后显示当前账号的剩余百分比、重置时间、可用重置卡数量；未返回的数据保持未知。设置支持手动或每 1 / 5 / 15 分钟同步，首次连接默认每 5 分钟。只有展开且首页卡片可见、或打开设置配置时才定期读取。完整额度窗口在配置中查看。

卡片「重置资讯」打开 SoloDock 内的独立日历页面，按北京时间展示 [AIHOT 的公开重置记录与预告](https://aihot.news/codex-reset)，可按月份和日期查看、跳转 X 原帖。此页面在「设置 → 工作区 → 显示功能」单独开关；设置中的公开动态源仍可打开原站。资讯数据通过固定的公开 API 只读获取，15 分钟内复用缓存，读取失败时保留上次结果。预告不用于推断个人已到账，也不自动使用重置卡。设置页两栏共用一个页面滚动。

通过官方 Codex app-server 的 `account/rateLimits/read` 读取；需要本机已安装且已登录的 Codex。macOS 自动检测 Codex / ChatGPT 应用内的客户端及常见 CLI 路径；其他平台检测 PATH 中的原生 `codex` / `codex.exe`，暂不执行 `.cmd` 包装脚本。Windows npm 包装安装方式可能提示未找到客户端，尚待适配及实机验证。

SoloDock 不读取或复制登录凭据，不发起模型任务，也不申请管理员、摄像头或录屏权限。额度只缓存在内存中，重复请求至少间隔一分钟；离开相关页面或收起面板后停止定期读取，已发出的请求会在完成或超时后结束。进程退出时清理读取子进程。此功能不提供账单价格、续费日期或由额度推算的 Token 总量。缺失数据保持未知，失败时隐藏旧额度，已到重置时间的数字不会继续显示为当前额度。

## 功能

| 模块 | 用途 |
| --- | --- |
| 随手记 | 任何应用里按 ⌥⇧N 记一条就走，不抢前台：自动判断存成随笔、待办（认得「明天下午3点」「周五前」）、链接或生活记录，刘海闪一下确认 |
| ⌘K 搜索 | 一处搜遍待办、笔记、提示词、链接、剪贴板和密钥（不搜密码），回车直接执行：跳转、复制、打开或粘贴回之前的应用 |
| 今天时间线 | 首页顶部一条轴：日程、待办截止、专注和 AI 完成；快速新建日程与「稍后提醒」 |
| 待办 | 1–6 个可改名、可换色的分类；筛选今天 / 逾期 / 已完成；「明天下午3点 …」自动识别截止时间；重复、提醒提前量、「在做」 |
| 番茄钟 | 专注计时与休息；专注期间 AI 提醒只计数，结束后汇总 |
| 时间 | 月历里每天一只「玻璃杯」：水位是工作时长、深色是专注；当天详情、本周作息；只记在用电脑与专注的时间段，不记任何应用或内容 |
| 生活 | 运动、冥想、阅读等习惯的次数与坚持：本周进度、连续达标周数、一至日七个圆点、月历小点、最近记录；和工作数据完全分开 |
| 通知中心 | 顶栏铃铛：找回 7 天内错过的提醒，分「需要你处理 / 今天 / 更早」，可直接跳回窗口、完成待办 |
| 刘海状态 | 面板收起时，刘海下沿只显示最要紧的一件事：Claude 需要你确认、录音、专注剩余时间、AI 额度不足、60 分钟内的日程、稍后提醒、已过收工时间；点一下直达对应页面，右键有快捷菜单 |
| 统一提醒 | 菜单栏下方的冰蓝玻璃提醒卡片，按类型给出操作按钮（⌃⌥↩ 执行主按钮）；含久坐、护眼、收工等身体与作息提醒 |
| 笔记 | 提示词库（变量标签、填好后复制）；笔记按今天 / 本周 / 更早分组，搜索高亮，预览里可勾任务框，⌘E 编辑，导出 .md；首页随笔每天自动归档 |
| 链接 | 左栏分组、两列链接与网站图标；剪贴板里刚复制的网址一键保存；拖到分组即移动，删除可撤销 |
| 录音 | 本地录音，可选实时转写；波形播放器与倍速，转写可存为笔记或挑出待办 |
| 当前窗口 | macOS 窗口枚举、读取与切换 |
| 密钥 | 系统安全存储加密的账号密码与 API Key；搜索后回车直接复制密码，复制的内容 60 秒后自动清除；API Key 可「复制为 KEY=value」，新增密码可一键生成；可开启密钥锁（Touch ID / Windows Hello 解锁，主密码备用），密码默认遮蔽 |
| 相框 | 单张或相册（最多 50 张）：说明文字、倒数日，每次展开面板或每天换一张，也可固定一张（原镜子，已移除摄像头） |
| 剪贴板 | 默认关闭，按需启用历史记录；密码管理器和密钥页复制的密码不会被记录 |
| AI 提醒 | 接收 Codex、Claude Code、GPT 的本机完成事件 |

首页组件可隐藏或调整布局。

## 从源码运行

需要 Node.js 22.12+ 和 npm：

```bash
git clone https://github.com/mrwuhoo/SoloDock.git
cd SoloDock
npm ci
npm test
npm start
```

测试包含单元测试、Electron 渲染与数据恢复检查、JavaScript 语法检查，需要桌面会话。

| 命令 | 用途 |
| --- | --- |
| `npm start` | 开发运行 |
| `npm test` | 桌面检查 |
| `npm run pack` | 生成未安装的本地应用 |
| `npm run build` | 构建 macOS DMG |
| `npm run build:win` | 在 Windows 构建 NSIS 安装包 |

## 权限与隐私

- 屏幕录制和辅助功能：用于 macOS 当前窗口卡片的读取与切换。
- 麦克风：点击录音时使用，结束或退出时释放。SoloDock 不使用摄像头。
- 钥匙串：加密保存敏感配置。权限弹窗请在系统界面处理。
- 转写与 AI 功能：启用后会将相应音频或文本发送给配置的服务；链接标题抓取会访问目标网站。
- AI 通知接口只监听本机 `127.0.0.1:43821`；不要将端口代理到公网。
- 日程、稍后提醒和专注记录只保存在本机工作区；时间线不记录你在用什么软件、看什么内容。
- 工作时间统计（时间页）只按时间段记录「在用电脑 / 专注」，判断依据是系统空闲时间；不记录应用名、窗口标题、网址或任何内容，只存在本机，保留 13 个月，可在「设置 → 身体与作息」关闭并清除。
- 密钥锁（可选）：开启后，每次启动 SoloDock、N 分钟未使用、锁屏或休眠后自动锁定，锁着时主进程不返回任何密钥。用 Touch ID / Windows Hello 解锁，主密码是备用方式，只保存 scrypt 哈希。密钥锁防的是别人趁你离开时打开密钥页；密钥本身始终由系统钥匙串加密，所以忘记主密码可以用 Touch ID 或电脑登录密码重置，不会丢失密钥（没有系统验证的电脑：退出后删除数据目录里的 `vault-lock.json` 即可重置）。Windows Hello 通过系统自带的 PowerShell 调用，尚待实机验证。
- 从密钥页复制的密码带有「机密」标记：SoloDock 的剪贴板历史、支持该约定的剪贴板管理器以及 Windows 剪贴板历史与云同步都不会记录；60 秒后、锁屏或休眠时、退出前自动清除（前提是剪贴板仍是这段密码）。

为兼容已有 Glass 版本数据，内部数据目录、钥匙串名称及 Bundle ID 暂时保留旧标识；界面品牌为 SoloDock。详情见[兼容说明](docs/brand/README.md)。重新打包或改变应用路径仍可能触发 macOS 再次授权。

## 项目结构

```text
main.js / main-services.js / platform.js  桌面主进程与平台服务
frame-store.js                          相框照片存储（数据文件夹 photo-frame/）
preload.js                              安全 IPC 桥
renderer/                               桌面界面与图标
build/                                  图标、签名与打包配置
scripts/ / tests/                       开发、验证与通知工具
website/                                SoloDock 静态介绍页
docs/                                   品牌、版权检查和发布说明
```

旧官网、人物照片、历史截图及本地参考材料不进入公开仓库。相框没有照片时显示 SoloDock Logo；用户自选的照片复制进数据文件夹的 `photo-frame/`（长边压缩到 1600px），只保存在本地。

## 发布与贡献

详见 [发布说明](docs/releasing.md)。公开源码不等于已完成 Apple 公证、Windows 签名或双平台发行验收。

欢迎通过 Issues 和 Pull Requests 反馈及贡献。不要上传个人工作区、录音、密钥或来源不明图片。安全报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证与致谢

[MIT](LICENSE) — Copyright (c) 2026 TO-DO Panel contributors；SoloDock 修改 Copyright (c) 2026 mrwuhoo。保留原许可全文和版权声明。

- [上游与修改记录](NOTICE.md)
- [图片和图标来源](ASSET_LICENSES.md)
- [依赖许可说明](THIRD_PARTY_NOTICES.md)
- [公开前检查](docs/open-source-review.md)

名称和图标尚未完成商标注册或全面近似检索，不代表上游背书。
