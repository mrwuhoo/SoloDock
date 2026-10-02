# SoloDock 开发交接（2026-09-26）

写给接手开发的 AI 或工程师。先读完这一页，再读 `AGENTS.md`（约定与红线）、`README.md`（产品行为的唯一事实来源）和 `docs/design/v0.2/design-spec.md` + `prototype.html`（逐页视觉与验收）。`AGENTS.md` 里有几节早于本轮最后几批改动，缺的细节以本页第 6 节为准。

---

## 1. 产品是什么、不能变的原则

SoloDock 是一个常驻 macOS 屏幕顶部刘海位置的 Electron 小面板，**一人公司（OPC）用户最好的伙伴**：工作时帮用户管理精力（待办、专注、提醒、AI 订阅额度），工作之外帮用户养成生活习惯。

用户明确锁定、不要改动的原则：

- **冰蓝磨砂半透明的玻璃风格不可改。** 只用 `renderer/tokens.css` 里的 `--sd-*` 变量，字号只用 11 / 13 / 14 / 17 / 22 / 40，圆角只用 30 / 22 / 12 / 8 / 胶囊。
- **面板是主要工作的「扶手」，绝不承接主要工作。** 一眼看完、一两步做完，然后回去工作。
- **只把 macOS 做到极致，暂不考虑 Windows 兼容。** `AGENTS.md` 里仍写着双平台，但用户当前的优先级是 macOS。
- **重视视觉设计感与美感。** 每页做完都要和原型截图并排对比。
- 界面文案用简洁、口语化的中文。

## 2. 仓库状态

| 项 | 状态 |
|---|---|
| 路径 | `/Users/smart_001/Downloads/Claude_agent/SoloDock` |
| 远程 | `https://github.com/mrwuhoo/SoloDock`（线上稳定版 v0.1.0） |
| 工作分支 | `v0.2-redesign`，领先 `origin/main` 35 个提交，**从未推送**，没有上游分支 |
| 工作区 | 干净，全部已提交 |
| 源码版本号 | `0.1.0`。不要改：`tests/release-policy.test.js` 要求它和 README、官网上的公开下载链接一致 |
| 体验包 | `dist.noindex/SoloDock-0.2.0-beta.1-arm64.dmg`、`…beta.2…dmg`，都是本地 ad-hoc 签名，没有公证，没有发布 |
| 测试 | 最后一次完整 `npm test`（提交 `7672e70`）：219 个单元测试加全部 Electron 测试通过 |

提交作者约定：`git -c user.name=mrwuhoo -c user.email=150499344+mrwuhoo@users.noreply.github.com commit …`。提交信息用英文，写清楚动机。**推送、打包、发布都必须先得到用户明确确认。**

## 3. 怎么跑

```bash
npm install
npm start          # 开发运行
npm test           # 全部检查，见下
```

`npm test` 执行 `scripts/test-desktop.js`，依次做四件事：

1. `node --test tests/*.test.js`：纯函数单元测试。
2. 一串 Electron 渲染测试（`tests/*.electron.js`，名单写在脚本里）。多数用 `tests/fixtures/panel-preload.js` 模拟 `notchAPI`：它是一个 Proxy，调用记录在 `window.__calls`，`on*` 订阅存在 `window.__handlers`，测试可以直接给 `window.notchAPI.xxx` 赋值来替换实现。
3. 真实主进程的端到端测试 `tests/startup.electron.js`：会把 home 指到临时目录（`app.setPath('home', …)`），不会碰真实的 `~/.claude`。
4. 最后对一批文件跑 `node --check` 语法检查。新增的渲染脚本要加进这份名单。

截图对比：`capturePage` 导出的 PNG 带显示器色彩配置，看颜色前先执行 `sips --matchTo "/System/Library/ColorSync/Profiles/sRGB Profile.icc"`。

### 打包体验包（每次都要用户确认）

这台 Mac 上 electron-builder 下载 DMG 工具会因为证书报错失败（见第 9 节），没有 Developer ID，也没有 Electron 下载缓存。已验证可行的流程：

```bash
npx electron-builder --mac dir --publish never \
  -c.electronDist=node_modules/electron/dist \
  -c.extraMetadata.version=0.2.0-beta.3        # 版本标签只写进安装包，不改 package.json
# 然后用 hdiutil 出 DMG：暂存目录里放 SoloDock.app 加一个指向 /Applications 的链接
hdiutil create -volname "SoloDock 0.2.0-beta.3" -srcfolder <暂存目录> -format UDZO -fs HFS+ dist.noindex/SoloDock-0.2.0-beta.3-arm64.dmg
```

打完用 `hdiutil verify`、只读挂载后 `codesign --verify --deep --strict`，再核对 Info.plist 里的版本和 `shasum -a 256`。冒烟测试打包版时要用临时 profile，并**预先放一个 `.first-run-done`**，否则首次运行会把这个临时副本加进开机启动。

## 4. 架构速览

- `main.js`（约 4400 行）：窗口、刘海定位、托盘、剪贴板、通知窗口、本机 HTTP（`127.0.0.1:43821`）、各类 IPC。
- `main-services.js`、`reminder-rules.js`、`vault-lock.js`、`notice-store.js`、`worklog-store.js`、`frame-store.js`：可单测的纯逻辑，不依赖 Electron。
- `preload.js`：contextBridge，所有 IPC 都从这里暴露为 `window.notchAPI.*`。
- `renderer/`：原生 HTML、CSS、JS，没有构建步骤，都是经典脚本。顶层函数和 `let` 是全局共享的，加载顺序见 `index.html` 底部。约定：`xxx-domain.js` 是 UMD 纯函数，页面和 Node 测试共用；`xxx-page.js` 负责页面交互，并对外暴露 `window.NotchXxx`。
- `renderer/styles.css`（约 6200 行）：**禁止在文件末尾追加覆盖规则。** 新页面的样式插在 `/* ============ 通知中心 ============ */` 之前。因为文件后部的旧规则在同等优先级下会胜出，新规则都加了父级前缀，比如 `.settings-pane …`。
- Esc 键不会原生传到页面，由主进程转发给 `onEscape`。`app.js` 里的处理顺序：首次引导 → 用量详情 → ⌘K → 待办页 → 链接页 → 密钥页 → 失焦 → 收起面板。

## 5. v0.2 完成情况（都在 `v0.2-redesign` 上）

| 模块 | 提交 | 说明 |
|---|---|---|
| ⌘K 搜索 | 88994ec | `search-domain.js` + `command-palette.js` |
| 随手记 ⌥⇧N | 55afe4a | 不激活应用的 NSPanel；不要对它调用 `focus()` |
| 待办页 | d8d3357 | 1–6 个分类、重复、提醒、在做；旧数据有迁移和备份 |
| 笔记页 | 1cbc547 | 分组列表、Markdown 预览、每日随笔同步 |
| 链接页 | b9d3b1e | 分组侧栏、剪贴板建议（只存哈希） |
| 录制页 | 64ee783 | 波形播放器、提取待办、实时视图 |
| 剪贴板页 | 0d9d662 | 只改视觉，交互不变 |
| 设置页 | b698ac4 | 分组导航；用 `NotchSettings.reveal(cardId)` 定位卡片 |
| 密钥页 | 1501a23 | 列表加详情、浮层编辑、复制提示条 |
| 暂停提醒 + 托盘精简 | ce5d54a | 见 6.2 |
| 首次引导 | ca73913 | 见 6.3 |
| 习惯提醒 + CSV 导出 | 4aa2cc9 | 见 6.4 |
| AI 额度提醒 | 3d08736 | 见 6.5 |
| AI 用量详情浮层 | 305040d | 见 6.6 |
| Claude 一键接入 | 0ab68b5 | 见 6.7 |
| 移出 DMG、修正路径 | 7672e70 | 见 6.8 |
| 首页改版 + 番茄钟新界面 | 见 `git log` | 见 6.9 |
| 更早：时间页、生活页、通知中心、刘海下沿状态、统一提醒卡片、密钥锁、相框、今天时间线等 | f9cc782 及之前 | 详见 `AGENTS.md` 和 `CHANGELOG.md` 的「未发布」 |

## 6. 本轮新增细节（`AGENTS.md` 还没写）

### 6.1 密钥页（`renderer/credentials-page.js`，对外 `window.NotchCredentials`）

- 顶部：搜索框（打开页面即聚焦）、新增、自动锁定倒计时、锁定 ⌘L。左侧 400 宽列表（「最近使用」取前 3 条，其余按名称排在「全部」），右侧是详情。
- 搜索框里 ⏎ 复制所选条目的密码，↑↓ 切换条目，⌘C 复制账号（有选中文字时不拦截），⌘N 新增，⌘↩ 在浮层里保存。
- 密码只在点「显示」（10 秒）和「编辑」时才用 `getCredential` 取一次明文，平时 DOM 里永远没有明文。
- 复制密码后出现深色提示条，60 秒倒计时进度条，可「立即清除」。清除走 IPC `credentials:clear-clipboard` → `clearSecretFromClipboard()`，只有剪贴板仍是这段密码时才清除。
- 多选批量删除已去掉，改为「⋯」里删除，需要点两次确认。旧的 `workspace.js` 密钥代码已删除。

### 6.2 暂停提醒 + 托盘

- 纯逻辑在 `reminder-rules.js`：`createReminderPause`、`pauseUntil`（`30m` / `1h` / `2h` / `today`，「今天」到次日 04:00）、`pauseResumeLabel`。
- 主进程在 `enqueueTaskNotification` 里判断：暂停期间照常写进通知中心，但不弹出（AI 完成的时间线统计照常计入）。恢复时只弹一条汇总「暂停期间有 N 条提醒」，这条汇总带 `record: false`，不再进通知中心。
- 暂停截止时间存在 `app-settings.json` 的 `remindersPausedUntil`，所以 `readAppSettings` 必须透传它，否则其他设置保存时会丢。电脑休眠醒来、屏幕解锁时再核对一次是否到期。
- IPC：`reminders:pause`、`reminders:resume`；界面入口在通知中心底部和顶部的暂停条，暂停时铃铛带斜线。
- 托盘菜单只保留五项：展开面板、随手记（显示快捷键）、暂停提醒 / 恢复提醒、设置…、退出 SoloDock。

### 6.3 首次引导（`renderer/onboarding.js`，对外 `window.NotchOnboarding`）

- 三步：怎么唤出（按用户设置的快捷键写）、常用功能（直接控制功能开关，剪贴板历史需要明确选中才开启）、接入 AI（Claude 一键接入；Codex 复制接入设置）。
- **谁会看到由主进程决定**：启动时、窗口创建之前，数据文件夹里既没有 `app-settings.json`，也没有 `workspace.json` 和 `Local Storage`，才写入 `onboardingPending: true`。看完或跳过后调 `onboarding:done` 清掉。升级上来的用户不会被打扰，可以在「设置 → 关于 → 重看首次引导」打开。测试用的模拟 preload 不提供这个标记，所以不会出现遮罩。

### 6.4 习惯提醒 + CSV（`life-domain.js` / `life-page.js`）

- 每个习惯可以设 `remindAt`（`HH:MM`，留空不提醒）；生活数据里另有 `remindWorkdays`（默认 false）。所有更新都用 `{ ...state }` 保留这两个字段。
- `habitReminderQueue(state, { now, offwork, days: 7 })`：工作日里早于收工时间的提醒跳过（勾选「工作日也按时提醒」后不跳过）；今天已经记过、或本周已达标的也跳过；00:30 这类凌晨时间算同一天（一天以 04:00 为界）。
- 页面把队列交给主进程的 `habits:schedule`（独立清单，不会覆盖今天时间线交来的 `reminders:schedule`）。提醒卡片上的「记一笔」经 `app:log-habit` 打开这个习惯的记录框。
- 导出：`recordsCsv` 生成带 BOM 的 UTF-8；以 `= + - @` 开头的格子前加 `'`，防止被当成公式执行。经主进程 `life:export` 弹出系统存储面板。

### 6.5 AI 额度提醒（`reminder-rules.js`：`createQuotaWatch` / `quotaWindows`）

- 某个额度窗口剩余 ≤ 20% 时提醒一次；以重置时刻区分周期，同一周期不重复。「本周期不再提醒」会让这家服务在本周期内都不再提醒。
- Claude 在每次状态栏上报时检查；Codex 在面板读取用量（`codex:usage`）时检查。
- 没有真实主进程的端到端测试：要测就得往 `127.0.0.1:43821` 发数据，而用户自己的 SoloDock 通常正在运行、占着这个端口。

### 6.6 AI 用量详情（`renderer/usage-detail.js`，对外 `window.NotchUsageDetail`）

- 点首页「AI 用量」卡片打开，宽 460，从卡片位置展开；放不下时往上长。
- 纯函数在 `ai-usage-domain.js`：`detailWindows`（每周窗口在前；已过重置时刻的不显示旧数字）、`exhaustEstimate`（按当前速度估计何时用完）、`momentLabel`。
- 数据只读 `NotchCodexUsage.state()` 和 `NotchAiUsageState.claude()` 里已经在内存中的内容。数据更新时发出 `notch:ai-usage-updated` 事件。

### 6.7 Claude 一键接入（`main-services.js`：`connectClaudeSettings` / `disconnectClaudeSettings` / `repairClaudeSettings` / `claudeSettingsStatus`）

- 用户点按钮后，主进程在 `~/.claude/settings.json` 里登记状态栏脚本，以及 Stop / Notification 两个钩子。**只加、只删 SoloDock 自己的那一项。** 用户原来的状态栏命令用 `--then '<原命令>'` 接在后面（单引号转义）；断开时原样还原。
- 第一次写入前留一份 `settings.json.before-solodock`；先写临时文件再替换，保留原文件权限；文件不是合法 JSON 时一律不写。
- 脚本用 App 自带的运行时执行：`ELECTRON_RUN_AS_NODE=1 "<execPath>" "<app>/scripts/claude-statusline.js"`。打包配置里 `asar: false`，所以脚本是真实文件，外部进程能直接运行。
- IPC：`claude:connect`、`claude:disconnect`，只接受主窗口发起的调用。

### 6.8 安装位置（`main.js`：`appLocationStable` / `offerMoveToApplications`）

- 打包版不在「应用程序」文件夹里运行时（从 DMG 或被系统临时转移的位置），启动时询问是否移过去（用 `app.moveToApplicationsFolder`，替换旧版本）；这种情况下 `claude:connect` 返回 `not_installed`。
- 每次启动用 `repairClaudeSettings` 把已登记的 SoloDock 命令改成当前路径，只改不增。起因：用户曾直接从 DMG 运行，登记进去的是 `/Volumes/…` 路径。

### 6.9 首页改版（2026-09-30，原型经用户确认）

- 布局固定为四张卡片：「现在」（1.55 份宽）· 「精力」· 右侧一列（AI 用量在上、相框在下）。拖动换位和四档尺寸已删除；设置里只能隐藏卡片（至少留一张），隐藏的不占位。显隐存 `notch-home-hidden-modules-v2`；第一次启动从 v1 只沿用「隐藏了 AI 用量 / 相框」。随笔、今天、番茄钟三张卡合并进「现在」，快速录音与当前窗口从首页移除（录音的暂停 / 结束本来就在录音页详情里；`windows:list` / `windows:focus` / `media:screen-recording` 一并删除）。
- 「现在」（`renderer/home.js`，对外 `window.NotchHomeNow`）：这件事 = 「在做」的待办，否则今天最急的一件；「换一件事」从待办里挑，选中即设为「在做」。接下来 = 今天剩下的日程与截止（最多两条）。「记一笔」走随手记同一条路（`window.NotchCaptureApply.apply`）。
- 2026-10-01 用户选定「时间圆盘 + 刘海光带」：卡片里的计时是时间圆盘（同日改为：一圈 = 这一轮的时长，每分钟一格刻度，开始纯白、走过的时间顺时针染蓝，`home-domain.js` 的 `elapsedFraction` / `discTicks` / `wedgePath`；不显示数字，悬停浮出 `remainingText`）；收起时下沿底边一道光从正中向两边延长（`notch-status-domain.js` 的 `progress` / `bandTone`），下沿文字写几点结束。同时做过的滴水、冰晶、月相等方向的原型只在 artifact 里，没有进仓库。
- 2026-10-02 用户改选「锤子时钟 · 拉环计时器」，替换上面的时间圆盘：`home-domain.js` 的 `dialPoint` / `dialArc` / `dialTicks` / `dialMinutesAt` / `dialStep` / `dialResist` / `dialSettle` / `remainingMinutes`（`elapsedFraction` / `discTicks` / `wedgePath` 已删）。一圈 = 60 分钟，弧 = 剩下的时间，超过 60 分钟画第二圈；拖拉环（`.now-dial-tab`）或点表盘定时长，阻尼跟手、越界只跟三成、整分钟吸附、松手 280ms 回弹（减弱动态效果时直接落位，窗口在后台没有动画帧时到点直接落位）、快速一甩最多 ±5 分钟惯性；方向键 ±1、PageUp/PageDown ±5、Home/End、滚轮。计时中拨表盘调用 `NotchPomodoro.setRemaining(seconds)` 改剩余时间。表盘在空闲 / 专注 / 休息都在卡片左侧同一位置；中间始终显示分钟数（推翻了 10/1「不显示数字、悬停才看」的决定，用户选拉环时看过带数字的样稿）。`#now-duration` 四档按钮、`#now-peek`、`#now-disc-big` 已删除。
- 番茄钟计时（`renderer/focus-timer.js`，对外 `window.NotchPomodoro`）：按结束时刻计时；时长 1–120 分钟任意整数存 `notch-focus-minutes-v1`（旧的 `[分, 秒]` 只沿用正好是 15 / 25 / 45 / 60 之一的）。**回滚**：旧版本只认 15 / 25 / 45 / 60，读到别的数会回到 25 分钟，不丢别的数据；暂停、+5 分钟（总长不超过 2 小时）、提前结束（专注满 1 分钟记下时长，专注记录多一个 `complete: false`，不算番茄）。专注中收起的 AI 通知数由主进程 `focus:held` 推送。
- 「精力」：主进程 `energy:status` 给距离上次休息（`bodyTracker.state().activeSince`）、久坐提醒分钟数、收工时间与 `worklogEnabled`；「休息 5 分钟」调 `body:break` 再开始 5 分钟休息。纯函数在 `renderer/home-domain.js`。**用户要求：只陈述事实，不和平时比较、不显示平均、不打分**；暖色只用来提醒该歇了或某天超过 10 小时。
- 矮屏（内容区不足 540）靠 `@container` 收起说明文字与第二条「接下来」。

## 7. Claude 订阅额度（2026-09-29 已实现）

**已实现**：`claude-usage.js`（虚拟终端 `createScreen`、`parseUsageScreen` / `parseResetTime` / `mergeUsageWindows`、`findClaude`、`claudeEnvironment`、`ensureOnboarded`、`createClaudeUsageService`），主进程 `claude:usage`（状态栏 10 分钟内的数据优先，否则自动读 `/usage`；成功缓存 15 分钟、失败 2 分钟）与 `claude:login`（运行 `claude auth login --claudeai`）。界面按错误码显示：`login_required` →「登录 Claude」，`not_installed` →「安装方法」，`network` / `rate_limited` / 其他 → 稍后自动重试。伪终端用 `/bin/sh -c 'cat | exec /usr/bin/script -q /dev/null …'`：Node 给子进程的输入是 socket，`script` 直接用会报 `tcgetattr: Operation not supported on socket`，中间的 `cat` 把它转成普通管道；进程组 `detached`，结束时整组清理。测试：`tests/claude-usage.test.js`，其中 `tests/fixtures/claude-usage-tui.txt` 是一次真实 `/usage` 输出（个人信息已按原长度替换，**替换时必须保持长度**，否则光标定位错乱）。

以下是决策背景，保留备查。

**目标**：像 Codex 一样自动显示 Claude 的 5 小时和每周额度，满足三个条件：不读取任何登录凭据、不消耗用户额度、用户不需要手动处理配置文件。

**现状**：已经实现了状态栏方案（6.7），但 Claude Code **只在终端里交互运行时**才把 `rate_limits` 交给状态栏。Claude 桌面 App 的 Code 页会运行钩子（完成提醒是通的），却不运行状态栏。用户平时用桌面 App，所以一直收不到额度数据。

**用户已明确否决、不要再提的方案：**

1. 从钥匙串读取 Claude Code 的 OAuth 令牌，或用 claude.ai 的网页登录态，去调 `/api/oauth/usage`。原因：有账号风险，「不能让用户使用有风险的功能」。
2. 只放一个打开 claude.ai 用量页的入口。原因：起不到规划 AI 订阅的作用。
3. 在后台让 Claude Code 发一次模型请求，从返回的 `rate_limit_event` 里读额度。原因：会消耗额度，而且只能拿到最紧的那一个窗口。

**已选方向（参考 ClaudeBar 默认的「CLI 模式」）**：在一个专用文件夹里，用伪终端启动本机的终端版 `claude`，输入 `/usage`，解析屏幕上的 5 小时、每周、分模型额度和重置时间。`/usage` 是交互界面命令（`local-jsx`），不能用 `-p` 模式跑；它不调用模型、不消耗额度。Anthropic 的用量接口限流很严，最多每 15 分钟刷新一次。

**已验证的事实（2026-09-26）：**

- 用户网络里的 HTTPS 被拦截，Node 默认不信任对应证书。启动 `claude` 必须带 `NODE_OPTIONS=--use-system-ca`（Node v23.11 支持）；带上后能连上 Anthropic。
- 用户的终端版 `claude`（Homebrew 安装，v2.1.81）原本从没登录过。现在已用 `claude auth login --claudeai` 登录（Pro 订阅），首次向导也由用户手动走完了。
- `claude auth status --json` 可以判断是否已登录，不涉及令牌内容。
- **注意**：只要 `~/.claude.json` 里没有 `hasCompletedOnboarding`，交互界面就会从头走首次向导，而且**不管有没有登录**都会显示「选择登录方式」。`claude auth login` 不会写这个标记。
- 验证脚本：`docs/handoff/claude-usage-probe.py`。用法：`python3 docs/handoff/claude-usage-probe.py /opt/homebrew/bin/claude <工作文件夹> <原始输出路径>`。它会自动接受主题和安全提示；「是否信任文件夹」会用方向键移到 Yes 后再回车；看到登录选择就返回 `not_logged_in`，读到额度就返回 `ok: true` 和相关行。

**✅ 2026-09-29 验证通过**（在用户自己的终端里跑，结果 `ok: true`，全程约 10 秒，不读凭据、不消耗额度）。`/usage` 打开的是「Usage」页，读到的内容：

```text
Current session
█████████▌   19% used
Resets 12:40am (America/Los_Angeles)
Current week (all models)
█▌   3% used
Resets Oct 6 at 4pm (America/Los_Angeles)
```

同一时刻状态栏显示「5h 剩 81% · 周 剩 97%」，两边一致。Max 订阅可能还会多出分模型的每周窗口（Opus / Sonnet / Fable），解析时按标题逐块读取，不要写死只有两块。

这次验证还发现：

- 「是否信任文件夹」这一版**默认选中的是「No, exit」**，直接回车会让 `claude` 退出。必须先移到「Yes, I trust this folder」。信任记录由 Claude Code 自己写进 `~/.claude.json` 的 `projects[<文件夹>].hasTrustDialogAccepted`。
- 只去掉 ANSI 转义序列会丢字母（比如「Current week」变成「Currnt week」、「Total cost」变成「Tota os」），因为 Claude Code 的界面靠光标定位来画，不是逐行输出。**正式实现要用虚拟终端还原真实画面再解析**：Node 端推荐 `@xterm/headless`（纯 JS，不用重新编译）；把输出喂进去，读 `buffer.active` 的每一行。
- 用户的 Homebrew 版 Claude Code 已经升级到 v2.1.285（设置了 `DISABLE_AUTOUPDATER=1` 也可能是用户自己升级的），界面文字会随版本变化，解析要按关键词和百分号来找，别依赖固定行号。
- 重置时间带时区名，格式有「12:40am」和「Oct 6 at 4pm」两种，解析时用该时区换算成时间戳。

**下一步：**

1. ~~请用户在自己的终端里运行验证脚本~~（已完成，见上）。
2. 在 SoloDock 里实现，建议做成新的只读服务，比如 `claude-usage.js`，写法仿照 `codex-usage.js`：
   - 在专用文件夹（例如 `userData/claude-probe/`）里启动伪终端。优先用 macOS 自带的 `/usr/bin/script`，免得引入需要重新编译的原生模块；输出交给 `@xterm/headless` 还原画面。
   - 设置 `NODE_OPTIONS=--use-system-ca` 和 `DISABLE_AUTOUPDATER=1`，去掉继承来的 `CLAUDE*` / `ANTHROPIC*` 环境变量。
   - 设总超时；退出时一边读输出一边等进程结束，必要时强制结束。不要在不读伪终端的情况下死等进程退出，否则会互相卡住。
   - 每 15 分钟最多刷新一次；遇到限流就退避。
   - 结果只放在内存里；解析失败时隐藏旧数字（和 Codex 的规则一致）。
3. 界面：用 `claude auth status` 判断，未登录时显示「登录 Claude Code」按钮，点击运行 `claude auth login --claudeai`，由 Claude Code 自己打开浏览器。
4. **待用户决定**：对从没用过终端版的用户，SoloDock 要不要替他在 `~/.claude.json` 里补上 `hasCompletedOnboarding`（以及专用文件夹的信任记录，ClaudeBar 就是这么做的），还是请用户自己在终端里走一次向导。

**解析要点**：`/usage` 的界面是给人看的，要用虚拟终端还原画面后再读（见上），Claude Code 改版后可能需要跟着调整。解析失败时给出明确状态，不要猜数字。桌面 App 自带的 `~/Library/Application Support/Claude/claude-code/<版本>/claude.app/Contents/MacOS/claude` 能不能单独使用、登录状态是否可用，**还没验证**。

## 8. 已放弃或暂不做

- **录屏与共享屏幕时隐藏面板**：放弃。在 macOS 26 + Electron 44 上，`setContentProtection(false)` 撤不回隐藏状态，而且基于 ScreenCaptureKit 的新版录屏和会议软件照样能录到窗口。做成「只在密钥页隐藏」会导致用户自己的截图和录屏里一直看不到面板。未发布的补丁没有进仓库。
- `scripts/smoke-app.js` 已过时（按 Windows 写的，还检查已删除的组件），不要依赖它。

## 9. 这台 Mac 上已知的环境问题

- 网络会拦截 HTTPS：Node 程序需要 `--use-system-ca`；electron-builder 下载 DMG 工具即使加了它也失败，所以改用 `hdiutil`。
- 用户自己的 SoloDock 通常在运行，占着 `127.0.0.1:43821`。**测试不要往这个端口发数据**，否则会把假数据灌进用户正在用的 App。
- 不要触发系统权限弹窗：曾经有一次用 osascript 查询「系统事件」卡住，并可能弹出了自动化授权。取前台应用用的是 NSWorkspace 的 JXA，不会弹窗。
- AI 代理的沙盒会拦截对外 TLS；代理自己不能修改 `~/.claude.json`（被权限规则判定为修改自身配置）。需要这类操作时，请用户在自己的终端里执行。

## 10. 等用户决定的事

0. **新 logo（2026-09-29 记下，暂缓）**：用户认为现在的 logo（AI 生成的「方块 + U 形托」，边缘有黑色杂点）不好看。已出三个矢量方向：A 刘海下拉 / B 光点与底座 / C S 字玻璃。推荐 B，用户还没选，要求先集中优化功能。选定后精修，生成 `build/solodock-icon.png` / `.icns` / `solodock.iconset` 与 `docs/brand/solodock-logo.png`，并更新 `docs/brand/README.md`。
1. **付费或支持者项目的内容**（规范里的「支持者提醒主题」：水波、极光、光带、晨露）：用户说体验一段时间后再定。解锁方式、素材包怎么分发（规范要求素材包不放进 MIT 代码）都没定。
2. **体验包**：`0.2.0-beta.5`（6.9 的首页改版 + 时间圆盘与刘海光带）已于 2026-10-01 打好，`dist.noindex/SoloDock-0.2.0-beta.5-arm64.dmg`，SHA-256 `86b327de677909c192e5e4d14c260ec3d7a3e12437a5c53794304607a786889f`，用户正在体验（之前的 beta.4 只有首页改版）。时间页顶部的「比上月」「日均」用户说暂时不动。
3. **正式发布 v0.2**：推送分支和标签、改版本号、更新 README 和官网下载链接、Windows 检查。都要用户确认，并遵守 `AGENTS.md` 的「GitHub 推送与发布联动」。
4. 第 7 节里 `hasCompletedOnboarding` 由谁补。

## 11. 红线（在 `AGENTS.md` 的 NEVER 清单之外补充）

- 不读取、不复制任何登录凭据（Claude、Codex、claude.ai）；AI 代理也不经手用户的 API Key，需要时由用户自己填写。
- `~/.claude/settings.json` 只能在用户点击「一键接入 / 断开」时由 SoloDock 修改，而且只动自己的那一项。
- 密码只能走 `writeSecretToClipboard`；密钥库只能在 `vaultAccessAllowed()` 之内读写；渲染层的列表永远拿不到明文。
- 数据结构变更必须带迁移和回滚，旧数据永远不丢。
- 生活数据与工作数据完全分开，不进首页、时间统计和通知中心的工作分组。
- 不打包、不推送、不发布，除非用户明确同意。
