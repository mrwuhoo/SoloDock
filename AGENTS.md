# SoloDock

一个常驻 macOS 屏幕顶部的本地工作台。默认折叠成物理刘海大小，点击从顶部展开，包含**首页 / 待办 / 笔记 / 链接 / 录制 / 密钥**等页面；剪贴板默认关闭、可从菜单栏「显示功能」启用；还可接收 Codex / Claude Code / GPT 的本机完成事件并关联当前窗口。

项目为单一 Electron 架构：折叠态、展开工作区、任务完成提醒与 Hover + Space 唤出都在 Electron 主进程和渲染层内实现，`npm start` 是唯一运行路径。

> **文档准绳**：产品行为以 [README.md](README.md) 为唯一事实来源。本文与 README 冲突时以 README 为准。

> **交接**：当前开发进度、进行中的工作（Claude 订阅额度）、等用户决定的事与本机环境问题见 [docs/HANDOFF.md](docs/HANDOFF.md)，接手前先读。

## 技术栈

- 桌面端：Electron 44 + 原生 HTML/CSS/JavaScript，无渲染层构建步骤
- 官网：静态 HTML/CSS，位于 `website/`；旧官网仅本地归档。
- 数据：LocalStorage + `userData/clipboard-images/` + `userData/recordings/`，无后端和云同步
- 包管理器：npm
- Node：桌面端使用 Node 22.12+；静态官网无需 Node。

## 命令

- 桌面开发：`npm install && npm start`
- 桌面检查：`npm test`
- 桌面打包：`npm run build`（只在用户明确确认后执行）
- 官网开发：直接打开 `website/index.html` 或用本地 HTTP 服务预览。
- 官网检查：检查 HTML 资源、仓库链接与发布状态，部署仅手动执行。

## 目录结构

```text
.
├── main.js                 # Electron 主进程：窗口、定位、菜单栏、剪贴板、媒体与通知服务
├── main-services.js        # 可单测的纯领域服务（无 Electron 依赖）
├── preload.js              # contextBridge 安全桥接
├── renderer/               # 桌面界面与交互（index.html / styles.css / app.js / workspace.js / notification.*）
├── build/                  # DMG 打包钩子、entitlements 与应用图标
├── scripts/                # Codex 与 Claude Code 的通知转发脚本
├── tests/                  # Node 单元测试
├── docs/                   # 设计说明、ADR 与验收图
├── website/                # 官网 React/Vinext 源码
└── package.json
```

## 当前产品约束

- 双平台：macOS 13+ arm64 与 Windows 10/11 x64 共用代码及版本。Windows 使用 `npm run build:win` 生成 NSIS EXE；发布必须两个平台检查通过后汇总至同一 Release。
- Windows：折叠态为 200 × 38 DIP，贴工作区顶部居中并避开任务栏；剪贴板只复制，提醒点击关闭。
- 便携媒体路径：LocalStorage / workspace.json 中新写入的录音与剪贴板图片使用 `/` 分隔的相对路径，系统加密密钥不保证跨电脑迁移。

- 折叠态：宽 200px；空闲时高度等于当前屏幕菜单栏高度，不超出物理刘海；有状态时只向下延伸 24pt（`NOTCH_STATUS_LIP`），宽度不变、不遮挡菜单栏图标。显示哪条状态由渲染层 `notch-status-domain.js` 决定（需要你确认 ＞ 录音 ＞ 专注 / 休息 ＞ 额度低于 20% ＞ 60 分钟内日程 ＞ 稍后提醒 ＞ 收工后）；专注 / 休息进行中时下沿写「几点结束」，底边的「刘海光带」（`.notch-status-progress`，`progress` + `bandTone`）从正中向两边显示进度，文字被更要紧的状态占用时光带照样显示，`notch:status` 只负责加高或恢复窗口；下沿是黑色，与物理刘海连成一体，深色表面的颜色用 `--sd-on-dark-*`。右键刘海弹出原生菜单（`notch:menu`）。「AI 需要你确认」来自 Claude Code 的 Notification 钩子（仅权限类消息，`needsInputMessage`），任务完成、跳回处理或 15 分钟后清除。
- 展开态：各页内容区统一 `1240 × 540`；窗口总高为 `76 + 540`，窄屏与矮屏保留 24px 安全距
- 待办（`renderer/todo-domain.js` + `renderer/todo-page.js`，数据只归待办页，其他模块经 `window.NotchTodos` 读写）：分类 1–6 个（`notch-todo-categories-v1` = `[{ id, name, color }]`，4 类 2×2、5–6 类 3×2），`notch-todo-data` 仍是「分类 id → 待办数组」，原来的四类沿用 `P0`–`P3` 作为 id，新增分类只多出新键；第一次升级把旧数据原样备份到 `notch-todo-data-v1-backup`，P0–P3 的名字同时写回 `notch-todo-category-names-v1`，方便回滚。删除有待办的分类必须先合并到别的分类，已删除分类残留的待办并入第一个分类，**永远不丢**。待办可选 `repeat`（每天 / 工作日 / 每周 / 每月 X 日 / 每 N 天·周·月，完成后生成下一次，月底按当月最后一天）、`remindMin`（-1 不提醒 / 0 准时 / 提前 N 分钟；旧待办没有这一项时仍是提前 1 小时，新建默认 15 分钟）、`completedAt`。「在做」全局一条（`notch-todo-doing-v1`），就是首页「现在」这件事。截止时间默认当天 23:30（已过 23:30 则明天），添加行用 `NotchCapture.parseWhen` 识别日期
- 剪贴板：默认关闭（`DEFAULT_FEATURES.clip = false`），可在菜单栏「显示功能」中启用。历史记录由主进程轮询采集，不再占用任何全局快捷键（见 `clipboardServicePolicy`）
- 密钥锁（方案 A，`vault-lock.js`）：Touch ID（`systemPreferences.promptTouchID`，指纹不可用时系统会让输入登录密码）/ Windows Hello（PowerShell 调 WinRT `UserConsentVerifier`，脚本见 `windowsHelloScript`）解锁，主密码只存 scrypt 哈希（`userData/vault-lock.json`）。数据仍由 safeStorage 加密，忘记主密码靠系统验证重置，绝不能因此丢数据。锁状态只在内存，启动即锁定；N 分钟未使用（1/5/10/30/60，默认 10）、锁屏、休眠自动锁定，锁定时清掉 SoloDock 写入的密码。主密码连续错 5 次冷却 30 秒。系统验证弹窗期间用 `withSystemInteraction` 防止面板失焦收起。
- 密钥条目：`kind` 为 `password`（默认，旧条目）或 `apikey`；可选 `url`、`note`、`lastUsedAt`。API Key 的变量名存在 `account`（`credentialEnvName` / `deriveEnvName`，渲染层 `NotchDomain.deriveEnvName` 与之同规则），这样旧版本仍能读出完整条目。复制字段：`account` / `password` / `env`（KEY=value，机密写入）/ `url`。
- 机密内容：带 `org.nspasteboard.ConcealedType` / `TransientType`（macOS）或 `ExcludeClipboardContentFromMonitorProcessing`（Windows）标记的内容一律不记录、不读取文字。密钥页复制密码时用 `writeSecretToClipboard` 写入这些标记（Windows 另写 `CanIncludeInClipboardHistory` / `CanUploadToCloudClipboard` = 0），主进程只保留哈希；60 秒后、锁屏或休眠时、退出前，若剪贴板仍是该密码就清除。Windows 标记尚待实机验证。
- 链接（`renderer/links-domain.js` + `renderer/links-page.js`，对外 `window.NotchLinks.add`）：只允许公开 http/https；主进程抓取标题时必须阻止本机、内网与不安全重定向。数据仍是 `notch-link-groups` = `[{ id, name, links: [{ id, url, title, icon, createdAt }] }]`，「未分组」就是名字为「未分组」的分组（按需创建）。图标只接受 `data:image/` 地址（CSP 只放行 data:）。剪贴板建议只在打开链接页时读一次剪贴板（主进程已屏蔽机密内容），看到过 / 忽略过的网址只存哈希（`notch-link-clip-seen-v1`、`notch-link-clip-dismissed-v1`）。
- 录制：音频写入 `userData/recordings/`，转写与元数据保存在 LocalStorage；可选百炼 Qwen3-ASR 实时转写，API Key 必须经 `safeStorage` 加密或环境变量读取
- 相框（原镜子）：只显示用户自选的照片，不调用摄像头；v0.2 起摄像头与汽水音乐组件已移除。照片由 `frame-store.js` 存进数据文件夹 `photo-frame/`（`<id>.jpg` 长边 ≤ 1600 + `<id>.thumb.jpg` 320，最多 50 张，id 必须匹配 `photo-[a-z0-9-]`）；说明文字、倒数日、顺序、固定与切换方式在 LocalStorage `notch-frame-v1`。v0.1 的 `mirror-cover.jpg` 首次读取时迁入相册，原文件保留用于回退。移除照片要等撤销提示结束后才删文件。
- 首页（`renderer/home-domain.js` + `renderer/home.js` + `renderer/focus-timer.js`）：布局固定为「现在 · 精力 · 右侧 AI 用量 / 相框」，只能在设置里隐藏卡片（`notch-home-hidden-modules-v2`，至少留一张），没有拖动和尺寸。「现在」= 「在做」的待办或今天最急的一件 + 番茄钟 + 接下来 + 「记一笔」（走 `NotchCaptureApply.apply`，和随手记同一套规则）。番茄钟状态只在 `window.NotchPomodoro`（按结束时刻计时，时长 `notch-focus-minutes-v1`，每次变化派发 `notch:pomodoro-changed`）。「精力」读 `energy:status` 与 `worklog:range`，**只陈述事实：不和平时比较、不显示平均、不打分**。通知里的「跳回窗口」仍用辅助功能扫描窗口（`scanCurrentWindows`），但 SoloDock 不再主动申请任何权限。
- 笔记（`renderer/notes-domain.js` + `renderer/notes-page.js`，对外 `window.NotchNotes`）：笔记存 `notch-note-archive-v1`（最多 200 条）。首页随笔卡片已移除；旧版留下的 `notch-home-note` 仍由 `rollHomeNote` 在跨天时归档进当天的「M月D日 随笔」（id 记在 `notch-note-active-archive-v1`，日期记在 `notch-home-note-day-v1`），没有记录日期时只记下今天、不清空。笔记页的编辑区是透明文字的 textarea 叠在同字体的标记层上（`.nd-input` / `.nd-marks`），两者字体、行高、换行规则必须完全一致。停止输入 800ms 保存，写入失败显示「未保存」并 3 秒重试。导出走主进程 `notes:export`（系统存储面板，只写用户选的那一个文件）。
- 动效：窗口边界变更不使用系统动画；视觉动效由渲染层完成，并支持 `prefers-reduced-motion`
- 通知：菜单栏正下方的冰蓝玻璃卡片（不遮挡菜单栏），独立无焦点窗口宽 436、高 134（带按钮时 172），四周是阴影空间，卡片最宽 380、宽度随内容。透明窗口里 backdrop-filter 模糊不到桌面，所以卡片底色不透明，玻璃感靠渐变、高光与描边；主按钮永远是品牌冰蓝，类型只改变图标色调；每类提醒的按钮与停留方式由 `reminder-rules.js` 的 `reminderPresentation` 决定（`visibleMs: 0` 表示不自动消失），按钮经 `task-notification:action` 回到主进程执行，需要页面配合的动作（完成待办、开始休息 / 专注、待办挪到明天）通过 `reminder:action` 发给主窗口。显示带主按钮的提醒时临时注册 ⌃⌥↩，收起即注销。专注期间 AI 提醒由 `createFocusHold` 暂存。身体提醒由 `createActivityTracker` 每 30 秒读 `powerMonitor.getSystemIdleTime()` 判断，设置存在 `app-settings.json` 的 `body`（`saveAppSettings` 写回时保留）。HTTP 只监听 `127.0.0.1:43821` 的 `/notify/<source>` 与 `/usage/claude`（Claude Code 状态栏额度，由 `scripts/claude-statusline.js` 转发，只保留两个额度窗口），来源白名单 `codex` / `claude` / `gpt`；Codex 与 Claude Code 分别由 `scripts/codex-notify.js`、`scripts/claude-notify.js` 转发，子代理结束与云端会话不弹提醒

## v0.2 设计与开发约定

- 视觉依据：`docs/design/v0.2/prototype.html`（可交互原型）与 `docs/design/v0.2/design-spec.md`（逐页视觉、交互与验收清单）。
- 设计变量只写在 `renderer/tokens.css`；组件只引用 `--sd-*` 变量，不写裸色值、裸字号、裸圆角。
- 字号只用 11 / 13 / 14 / 17 / 22 / 40；圆角只用 30 / 22 / 12 / 8 / 胶囊；阴影只给浮层。
- **禁止在 styles.css 末尾追加覆盖规则**：改组件就改组件自己的那段样式；页面重做时删除旧段落。
- 页面按原型逐页重做：每页完成后与原型截图并排对比，并逐条满足规范里的「验收」。
- 数据结构变更必须附迁移与回滚；剪贴板页保持现有交互，只统一视觉。
- 时间页（`worklog-store.js` + `renderer/worklog-domain.js` + `renderer/time-page.js`）：身体提醒每 30 秒读一次系统空闲时间时顺带记一段「在用电脑 / 专注」（空闲 ≥ 5 分钟、锁屏、休眠不计），存 `userData/worklog.json`，一天以 04:00 为界，保留 13 个月；另记当天完成待办数（`worklog:todo`）与 AI 任务数。**不记录应用名、窗口标题、网址或任何内容**。开关在 `body.worklog.enabled`（默认开，关掉立即停止），「设置 → 身体与作息」可清除全部记录。
- 随手记（`renderer/capture-domain.js` + `renderer/capture.html/css/js` + `renderer/capture-apply.js`）：主进程启动 1.5 秒后预建隐藏窗口，macOS 上是 `type: 'panel'`（NSPanel，不激活应用）——**不要对它调用 `focus()` 或 `app.focus()`**，`show()` 就会成为键盘窗口而前台应用不变，隐藏后焦点自然回到原应用。窗口出现在鼠标所在屏幕、紧贴菜单栏，宽 600（卡片 552 + 阴影空间），高度由页面按内容经 `capture:resize` 上报（120–360）；失焦即隐藏（保留草稿），Esc 由 `before-input-event` 转发并在输入法选字时忽略。随手记窗口**只读** LocalStorage 做预览，从不写；提交经 `capture:submit`（校验发送方是随手记窗口，`normalizeCaptureEntry` 只收文字与类型提示、由主进程盖时间戳）转成 `capture:add` 发给面板，由面板用同一个 `parseCapture` 再解析并写入待办 / 笔记 / 链接 / 生活，避免两个窗口互相覆盖数据。随笔进当天一条「随手记 · M月D日」笔记（`notch-capture-note-v1` 记住当天那条的 id，凌晨 4 点为界）。快捷键存在 `app-settings.json` 的 `captureShortcut`（默认 `Alt+Shift+N`，空字符串 = 关闭，不能与唤出快捷键相同），注册失败不改设置，只通过 `captureShortcutRegistered` 在设置里提示。
- 设置页（`renderer/settings-nav.js`，对外 `window.NotchSettings`）：卡片仍由各自模块渲染，只是加了 `data-settings-group`（general / home / body / feat / ai / privacy / data / about），一次只显示一组（`.is-other-group`），上次的分组存 `notch-settings-group-v1`。**要把某张设置卡片带到眼前时调用 `NotchSettings.reveal(cardId)`**，不要直接 `scrollIntoView`（卡片可能在别的分组里被隐藏）。新样式都加了 `.settings-pane` 前缀，以免被旧样式覆盖。
- ⌘K 搜索（`renderer/search-domain.js` + `renderer/command-palette.js`）：只在面板展开时响应 ⌘K（捕获阶段监听，不注册全局快捷键）；每次打开现读各模块数据（待办、`notch-note-archive-v1`、提示词、`notch-link-groups`、`notch-clip-history` 文本条目、`listCredentials`），不建索引、不另存副本。密钥条目只带名称、账号与网址，**永远不把密码放进搜索条目**；密钥只能 `copyCredential`，⌘↩ 粘贴对密钥无效。最近使用存 `notch-palette-recent-v1`（最多 8 条，只存类型、id 与标题）。Esc 由主进程转发，`onEscape` 先交给 `NotchPalette.close()`。
- 生活页（`renderer/life-domain.js` + `renderer/life-page.js`）：习惯与记录只存 LocalStorage `notch-life-v1`（`{ habits, records }`，默认运动 / 冥想 / 阅读，最多 6 个习惯、3000 条记录），**与工作数据完全分开**：不进首页、时间统计与通知中心。目标按每周几次，连续 = 连续达标的周数（本周未达标不清零），一天以 04:00 为界。移除习惯会连同记录删除，需点两次确认。
- 通知中心（`notice-store.js` + `renderer/notice-center.js`）：每条提醒入队时记录到 `userData/notices.json`（保留 7 天、最多 300 条；回执、护眼与专注汇总不记，补发的不重复记）。在卡片或通知中心里处理过即 `handled`（「稍后提醒」不算）；Claude 继续完成时自动处理对应的「需要你确认」；打开通知中心即全部已读。顶栏铃铛在右侧页签组末尾，琥珀徽章 = 需要你处理，蓝色 = 未读。
- 今天时间线（`renderer/timeline-domain.js` + `renderer/today-strip.js`）：日程 `notch-events-v1`、稍后提醒 `notch-later-v1`、专注记录 `notch-focus-log-v1`（番茄钟每段写一条 `{ start, end, minutes, complete }`，提前结束的 `complete: false`、不算番茄，保留 500 条）、显隐 `notch-home-strip-v1`。渲染层每次改动后把完整提醒队列交给主进程 `reminders:schedule`，由主进程定时（面板收起也会提醒，错过超过 5 分钟不补发），触发后回传 `reminder:fired`。日程与稍后提醒不进「最近完成」。

## 代码规范

- 主进程文件 camelCase，常量大写下划线
- 渲染逻辑放在 `renderer/`，与主进程隔离
- IPC 必须通过 `preload.js` 的 contextBridge 暴露
- 视觉取值集中在 CSS 自定义属性中

## GitHub 推送与发布联动

- 任何产品更新推送到 GitHub 前，必须联动检查版本号、`CHANGELOG.md`、README 当前稳定版本与下载入口、GitHub Pages 下载按钮。
- 正式发布必须保证 `package.json` 与 `package-lock.json` 版本一致，推送匹配的 `v*.*.*` 标签，并在 GitHub Actions 完成后验证 Release 的 DMG / SHA-256 资产与 Pages 实际下载指向。
- README 与官网提供版本化双平台安装包链接；每次发布应与实际 Release 资产及 SHA-256 保持一致。

## NEVER

- NEVER 在渲染进程直接 `require('electron')`
- NEVER 让窗口可被拖出刘海位置；显示与模式切换必须贴顶居中
- NEVER 重新引入摄像头或第三方音乐 App 控制（v0.2 已移除）
- NEVER 在用户未主动点击时启动麦克风；结束录音或退出应用时必须释放音频 track
- NEVER 把剪贴板图片 dataURL 存入 LocalStorage
- NEVER 用 `clipboard.writeText` 复制密码或令牌，必须走 `writeSecretToClipboard`
- NEVER 在 `vaultAccessAllowed()` 之外读写密钥库；新增的密钥接口必须先过这道锁检查
- NEVER 把密码或 API Key 本身发给渲染层列表（`publicCredential` 只给遮蔽值）；只有编辑时的 `credentials:get` 返回明文
- NEVER 提交 `node_modules` 或 `dist`
- NEVER 在没有用户确认时打包或发布桌面应用

## 压缩指令

执行 `/compact` 时必须保留：

- 首页（现在 / 精力）的行为与样式细节
- LocalStorage 数据结构
- 已知 macOS、多屏与菜单栏适配问题
