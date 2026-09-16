<div align="center">
<img src="build/solodock-icon.png" width="120" alt="SoloDock Logo" />
<h1>SoloDock</h1>
<p><strong>一人公司的桌面效率工作台。</strong></p>
<p>待办、笔记、专注计时、链接、录音与 AI 完成提醒，收进一个磨砂玻璃面板。</p>
<p><a href="https://github.com/mrwuhoo/SoloDock">GitHub</a> · <a href="https://github.com/mrwuhoo/SoloDock/issues">反馈</a> · <a href="CHANGELOG.md">更新日志</a> · <a href="LICENSE">MIT</a></p>
</div>

> 基于 [xiaopu-ai/TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) v1.1.2 开发，由 mrwuhoo 独立维护。不是上游官方发行版，保留原版权与 MIT 授权，详见 [NOTICE.md](NOTICE.md)。

## 当前状态

源码版本 **0.1.0**。SoloDock 暂未发布独立安装包，请从源码运行；上游安装包不包含本项目修改。

- macOS 13+ Apple Silicon：本地开发与验证的主要平台。
- Windows 10/11 x64：继承上游兼容代码和构建配置，当前版本尚未完成 Windows 实机验收。
- UI：浅蓝磨砂玻璃、透明外壳、柔和圆角与卡片。

## 功能

| 模块 | 用途 |
| --- | --- |
| 待办 | 四组可改名分类、截止日期和到期提醒 |
| 番茄钟 | 专注计时与提醒 |
| 笔记 | Markdown 速记、归档与搜索 |
| 链接 | 收藏公开网址、获取标题和分组 |
| 录音 | 本地录音，可选实时转写 |
| 当前窗口 | macOS 窗口枚举、读取与切换 |
| 密钥 | 系统安全存储加密账号及 API Key |
| 镜子 | 主动点击后开启摄像头，也可使用自选配图 |
| 剪贴板 | 默认关闭，按需启用历史记录 |
| AI 提醒 | 接收 Codex、Claude Code、GPT 的本机完成事件 |

音乐组件沿用上游汽水音乐集成。首页组件可隐藏或调整布局。

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
- 麦克风：点击录音时使用；摄像头：点击镜子时使用，离开首页或收起面板后释放。
- 钥匙串：加密保存敏感配置。权限弹窗请在系统界面处理。
- 转写与 AI 功能：启用后会将相应音频或文本发送给配置的服务；链接标题抓取会访问目标网站。
- AI 通知接口只监听本机 `127.0.0.1:43821`；不要将端口代理到公网。

为兼容已有 Glass 版本数据，内部数据目录、钥匙串名称及 Bundle ID 暂时保留旧标识；界面品牌为 SoloDock。详情见[兼容说明](docs/brand/README.md)。重新打包或改变应用路径仍可能触发 macOS 再次授权。

## 项目结构

```text
main.js / main-services.js / platform.js  桌面主进程与平台服务
preload.js                              安全 IPC 桥
renderer/                               桌面界面与图标
build/                                  图标、签名与打包配置
scripts/ / tests/                       开发、验证与通知工具
website/                                SoloDock 静态介绍页
docs/                                   品牌、版权检查和发布说明
```

旧官网、人物照片、历史截图及本地参考材料不进入公开仓库。默认镜子配图已换成 SoloDock Logo，音乐背景使用 CSS 渐变。用户自选图片仍留在本地。

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
