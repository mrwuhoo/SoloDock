# SoloDock 0.1.0

一人公司的桌面效率工作台，基于 xiaopu-ai/TO-DO-Panel v1.1.2（MIT）独立开发。

- 浅蓝磨砂玻璃界面、圆角及卡片边框调整。
- 当前窗口读取与权限诊断改进。
- SoloDock 品牌、图标、上游署名和素材来源记录。

## 安装

- macOS 13+ Apple Silicon：下载 SoloDock-0.1.0-arm64.dmg，打开后将 SoloDock 拖入应用程序。Intel Mac 不在此包支持范围。
- Windows 10/11 x64：运行 SoloDock-0.1.0-windows-x64-setup.exe。
- 每个安装包附 .sha256 校验文件。

## 验证与限制

发布前执行单元测试、Electron 界面检查、macOS 签名/DMG 完整性检查，以及 Windows 安装、启动、重装数据保留与卸载自动验证。实体设备与多屏仍需更多反馈。

macOS 包采用本地证书或 ad-hoc 签名，未取得 Apple Developer ID 公证；Windows 包没有商业代码签名，系统可能提示来源确认。请勿关闭系统整体安全保护。

已有 Glass 用户继续沿用旧数据目录和内部钥匙串名称；系统可能再次要求权限或钥匙串授权。不要删除 Application Support 下的数据目录。转写和 AI 功能会访问用户配置的服务。
