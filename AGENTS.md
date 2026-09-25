# SoloDock

一个常驻 macOS 屏幕顶部的本地工作台。默认折叠成物理刘海大小，点击从顶部展开，包含**首页 / 待办 / 笔记 / 链接 / 录制 / 密钥**等页面；剪贴板默认关闭、可从菜单栏「显示功能」启用；还可接收 Codex / Claude Code / GPT 的本机完成事件并关联当前窗口。

项目为单一 Electron 架构：折叠态、展开工作区、任务完成提醒与 Hover + Space 唤出都在 Electron 主进程和渲染层内实现，`npm start` 是唯一运行路径。

> **文档准绳**：产品行为以 [README.md](README.md) 为唯一事实来源。本文与 README 冲突时以 README 为准。

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
- Windows：折叠态为 200 × 38 DIP，贴工作区顶部居中并避开任务栏；隐藏当前窗口组件，但不修改用户保存的显隐偏好；剪贴板只复制，提醒点击关闭。
- 便携媒体路径：LocalStorage / workspace.json 中新写入的录音与剪贴板图片使用 `/` 分隔的相对路径，系统加密密钥不保证跨电脑迁移。

- 折叠态：宽 200px，高度等于当前屏幕菜单栏高度，不得超出物理刘海
- 展开态：各页内容区统一 `1240 × 540`；窗口总高为 `76 + 540`，窄屏与矮屏保留 24px 安全距
- 待办：2 × 2 布局，一次回车新增，颜色为红 / 橙 / 绿 / 蓝。内部存储键仍是 `P0`–`P3`（`notch-todo-data` 结构不可变更），但界面显示名默认「课程 / 自媒体&写作 / Vibe coding / 日常」且用户可改名（存 `notch-todo-category-names-v1`）；截止时间默认当天 23:30，到期前一小时提醒
- 剪贴板：默认关闭（`DEFAULT_FEATURES.clip = false`），可在菜单栏「显示功能」中启用。历史记录由主进程轮询采集，不再占用任何全局快捷键（见 `clipboardServicePolicy`）
- 机密内容：带 `org.nspasteboard.ConcealedType` / `TransientType`（macOS）或 `ExcludeClipboardContentFromMonitorProcessing`（Windows）标记的内容一律不记录、不读取文字。密钥页复制密码时用 `writeSecretToClipboard` 写入这些标记（Windows 另写 `CanIncludeInClipboardHistory` / `CanUploadToCloudClipboard` = 0），主进程只保留哈希；60 秒后、锁屏或休眠时、退出前，若剪贴板仍是该密码就清除。Windows 标记尚待实机验证。
- 链接：只允许公开 http/https；主进程抓取标题时必须阻止本机、内网与不安全重定向
- 录制：音频写入 `userData/recordings/`，转写与元数据保存在 LocalStorage；可选百炼 Qwen3-ASR 实时转写，API Key 必须经 `safeStorage` 加密或环境变量读取
- 相框（原镜子）：只显示用户自选的照片，不调用摄像头；v0.2 起摄像头与汽水音乐组件已移除。照片由 `frame-store.js` 存进数据文件夹 `photo-frame/`（`<id>.jpg` 长边 ≤ 1600 + `<id>.thumb.jpg` 320，最多 50 张，id 必须匹配 `photo-[a-z0-9-]`）；说明文字、倒数日、顺序、固定与切换方式在 LocalStorage `notch-frame-v1`。v0.1 的 `mirror-cover.jpg` 首次读取时迁入相册，原文件保留用于回退。移除照片要等撤销提示结束后才删文件。
- 当前窗口：通过 macOS 辅助功能枚举和聚焦，使用系统应用图标；同应用多窗口编号；隐藏项保存在 LocalStorage；聚焦 IPC 只接受最近扫描缓存中的窗口 ID
- 笔记：首页随笔记保存后进入独立笔记页，可搜索、重命名、编辑和删除
- 动效：窗口边界变更不使用系统动画；视觉动效由渲染层完成，并支持 `prefers-reduced-motion`
- 通知：独立 `400 × 96` 无焦点窗口；HTTP 只监听 `127.0.0.1:43821` 的 `/notify/<source>` 与 `/usage/claude`（Claude Code 状态栏额度，由 `scripts/claude-statusline.js` 转发，只保留两个额度窗口），来源白名单 `codex` / `claude` / `gpt`；Codex 与 Claude Code 分别由 `scripts/codex-notify.js`、`scripts/claude-notify.js` 转发，子代理结束与云端会话不弹提醒

## v0.2 设计与开发约定

- 视觉依据：`docs/design/v0.2/prototype.html`（可交互原型）与 `docs/design/v0.2/design-spec.md`（逐页视觉、交互与验收清单）。
- 设计变量只写在 `renderer/tokens.css`；组件只引用 `--sd-*` 变量，不写裸色值、裸字号、裸圆角。
- 字号只用 11 / 13 / 14 / 17 / 22 / 40；圆角只用 30 / 22 / 12 / 8 / 胶囊；阴影只给浮层。
- **禁止在 styles.css 末尾追加覆盖规则**：改组件就改组件自己的那段样式；页面重做时删除旧段落。
- 页面按原型逐页重做：每页完成后与原型截图并排对比，并逐条满足规范里的「验收」。
- 数据结构变更必须附迁移与回滚；剪贴板页保持现有交互，只统一视觉。
- 今天时间线（`renderer/timeline-domain.js` + `renderer/today-strip.js`）：日程 `notch-events-v1`、稍后提醒 `notch-later-v1`、专注记录 `notch-focus-log-v1`（番茄钟每段写一条，保留 500 条）、显隐 `notch-home-strip-v1`。渲染层每次改动后把完整提醒队列交给主进程 `reminders:schedule`，由主进程定时（面板收起也会提醒，错过超过 5 分钟不补发），触发后回传 `reminder:fired`。日程与稍后提醒不进「最近完成」。

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
- NEVER 提交 `node_modules` 或 `dist`
- NEVER 在没有用户确认时打包或发布桌面应用

## 压缩指令

执行 `/compact` 时必须保留：

- 当前窗口行为与样式细节
- LocalStorage 数据结构
- 已知 macOS、多屏与菜单栏适配问题
