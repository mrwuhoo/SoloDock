# SoloDock

一人公司的桌面效率工作台。

## 图标

![SoloDock](solodock-logo.png)

单个悬浮方块代表独立工作者，下方圆角底座表示任务、笔记与工具的停靠位置。冰蓝、珍珠白与深蓝构成配色，磨砂材质与现有玻璃面板呼应。

- `solodock-logo.png`：生成原图，透明画布，保留原始 alpha。
- `../../build/solodock-icon.png`：1024px 打包图标。
- `../../build/solodock-icon.icns`：macOS 多尺寸图标。
- `../../renderer/assets/solodock-logo-128.png`：小尺寸备选资源。
- `imagegen-prompt.txt`：完整生成提示词。

图标使用内置 image_gen 生成；仅使用 macOS sips 和 iconutil 转换打包尺寸与格式。品牌名与图形尚未做商标检索，本图不构成任何注册或独占权承诺。

## 改名兼容

对外名称、应用 Bundle 显示名、安装包名和桌面界面使用 SoloDock。

为兼容已安装的 Glass 定制版，暂时保留 `com.dynamicpanel.glass` Bundle ID、`TO-DO Panel Glass` 用户数据目录、Electron 内部 app name，以及 build/afterPack.js 的本地证书目录。内部 app name 涉及 macOS safeStorage 钥匙串条目；不应仅为清理旧名称而直接改掉。系统钥匙串对话框仍可能出现旧 Safe Storage 名称。

这些措施保留已有数据和身份配置，但不能保证 macOS 在应用重打包或改路径后绝不重新请求授权。当前仅更新源码及打包资源，尚未替换本机已安装应用。

`website/` 为 SoloDock 的静态介绍页。旧官网、旧截图及来源不明素材仅保留在本地 `.local-archive/`，不进入公开仓库。

## 上游署名

SoloDock 基于 xiaopu-ai/TO-DO-Panel 开发。原 MIT LICENSE 与作者信息保留，新增修改归 SoloDock contributors 维护。
