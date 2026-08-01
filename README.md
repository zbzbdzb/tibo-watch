# Tibo Watch

Tibo Watch 是一个面向 Windows 10/11 x64 的本地桌面监测器。它每 5 分钟检查 `@thsottiaux` 的原创、回复和引用动态，判断是否出现 Codex 使用限制重置的确认、预告或相关信息，并通过 Windows 通知与可选 SMTP 邮件提醒。

> “已确认重置”仅表示 Tibo 已明确公告，不代表某个用户的个人 Codex 额度必然已经到账。

## 功能

- 公共 Nitter `with_replies` RSS：从维护中的实例注册表发现实例，缓存最后成功实例并自动故障切换。
- 可选 X 登录抓取：使用 `persist:x-monitor` 隔离会话；独立开关，默认关闭。
- 四级本地规则分类：确认、预告、相关、无关；不调用外部 AI 模型。
- 首次同步只建立历史基线；按动态 ID 去重；预告升级为确认时可再次提醒。
- 确认/预告发送有声 Windows 通知和邮件；相关动态使用静默 Windows 通知。
- SMTP 支持 STARTTLS/SSL、多收件人、测试邮件与 1/5/15 分钟持久化重试。
- 单实例、关闭到托盘、登录后隐藏启动、Windows 开机自启。

## 安装

从 `release` 目录运行：

```text
Tibo-Watch-Setup-0.1.1.exe
```

安装包为 per-user NSIS，无需管理员权限。首版未做代码签名，Windows SmartScreen 可能显示警告。卸载默认保留本地历史与配置。

## 首次使用

1. 启动应用并点击“建立历史基线并开始”。旧动态会入库，但不会补发通知。
2. 公共 RSS 默认启用；在“数据源”页检查健康状态。
3. 如需 X 登录抓取，在“设置”中打开隔离登录窗口。登录失效时重新登录即可。
4. 如需邮件，在“设置 → 邮件通知”填写 SMTP 主机、端口、用户名、应用密码、发件身份和收件地址，然后发送测试邮件。

## SMTP 常见配置

优先使用邮箱服务商生成的“应用密码”，不要填写主账号密码。

| 类型 | 常见端口 | 加密方式 |
| --- | ---: | --- |
| Gmail SMTP | 587 | STARTTLS |
| Gmail SMTP | 465 | SSL/TLS |
| Microsoft 365 SMTP 提交 | 587 | STARTTLS |
| 其他服务商 | 以服务商文档为准 | STARTTLS 或 SSL/TLS |

若测试失败，请依次检查：应用密码是否启用、SMTP 主机和端口、发件身份是否允许、VPN/防火墙、服务商是否禁用了基础 SMTP 验证。日志和界面不会输出应用密码。

## 数据、备份与隐私

默认数据目录：

```text
%APPDATA%\Tibo Watch\
```

- `tibo-watch.sqlite3`：动态、分类、来源观测、通知送达、邮件队列和设置。
- `Partitions\x-monitor`：隔离的 X 登录会话数据（具体子目录由 Electron/Chromium 管理）。
- SMTP 应用密码先经 Electron `safeStorage`（Windows DPAPI）加密，再存入 SQLite。

备份时先从托盘退出 Tibo Watch，再复制整个目录。恢复时同样先退出应用，然后覆盖回原位置。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 风险说明

X 明确限制非 API 的网站脚本化访问。启用 X 登录抓取可能导致会话失效、访问受限，极端情况下可能影响账号；该功能默认关闭且可随时退出登录。公共 Nitter 实例是非官方第三方服务，可能随时不可用或延迟。两路数据连续三个周期均失败时，应用只提示一次监测中断。

应用不读取个人 Codex 配额，不包含 VPN，不提供公网服务，不自动上传历史，不集成外部模型，也不包含自动更新。

## 开发

要求 Node.js 22.16+、pnpm 11 和 Windows x64。

```powershell
pnpm install
pnpm dev
```

验收命令：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm dist:win
```

项目结构：

```text
src/main       Electron 主进程、监测、SQLite、通知
src/preload    受限 contextBridge API
src/renderer   React 界面
src/shared     稳定领域接口和 IPC 类型
tests          单元、集成与 Electron E2E
```

## 安全边界

- 渲染器启用 CSP、上下文隔离和沙箱，不启用 Node 集成。
- 所有 IPC 调用校验发送方和 Zod 参数。
- X 窗口只允许 HTTPS 的 X/Twitter 域名导航，拒绝权限请求。
- 外链仅允许打开 `@thsottiaux` 的 X/Twitter 动态 URL。

## 许可证

MIT，见 [LICENSE](LICENSE)。
