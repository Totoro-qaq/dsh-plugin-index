# 公开索引与 Discover 安装验收

日期：2026-10-16（北京时间）。

## 范围

验收对象是公开索引和 DSH **0.2.1-alpha.4 WebUI** 的添加、安装、启用流程。使用全新的隔离 Home、profile、缓存和工作区，Node.js 22.23.1、pnpm 11.26.0；没有打开日常桌面 profile、读取日常会话、提供模型凭据或调用模型。

这不是原生 Desktop 的重新认证，不表示旧桌面版本已提供 Discover，也不表示桌面内置 pnpm 11.7.0 的已知挂起问题已经修复。

## 公开索引

```text
https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-index/main/index.json
```

- 实际 GET 为 **200**，使用 `redirect: error`，没有重定向。
- 远端 2,725 字节与本地生成文件逐字节一致。
- SHA-256：`8d796813f66831d5da52af5ebd66cb9d8064a779f9efa7b0e71bdf618a6cd1c2`。
- 通过官方 `parseMarketIndex`，只有 `dsh-jot@0.2.13`、`dsh-plugin-bridge@0.4.6` 两个确切安装目标，registry 均为 `https://registry.npmjs.org/`。
- 版本、发布时间、`engines.dsh` 已与 npm 官方元数据核对。

## 真实 UI 流程

初始环境没有安装 Jot、Bridge，也没有配置任何市场源。只预置并启用官方的自定义插件市场组件。

通过真实 WebUI 操作：

1. 打开插件页的 Discover，确认空状态。
2. 通过「添加索引源」输入上面的公网 URL；不是 localhost 文件，也没有通过控制接口预填源。
3. 页面显示随记 Jot 0.2.13、Bridge 0.4.6 两张卡片，均有可用的安装按钮。
4. 逐个核对信任确认框中的包名、版本和官方 registry，再安装。
5. 等安装向导显示「已安装／已完成」，分别点击「立即启用」。
6. 回到 Discover 并强制刷新，两张卡片均显示「在已安装中查看」。

| 检查 | 结果 |
| --- | --- |
| Jot 安装与启用 | 磁盘及 manager 均为 0.2.13，installed/enabled 均 true |
| Bridge 安装与启用 | 磁盘及 manager 均为 0.4.6，installed/enabled 均 true |
| 安装内容核验 | Jot 的 3 个 lib 文件、Bridge 的 33 个 lib 文件与各自 npm tarball 逐字节一致；tarball 的 SHA-512 SRI 通过 |
| Bridge 命令 | 合成会话中 `/bridge --doctor --lang en` 返回 13/13；未向模型发送消息 |
| Jot 客户端 | 侧栏出现随记入口；打开后正常显示笔记列表与工具栏 |
| Jot AI 边界 | UI 开关为关闭，`/jot/api/state` 为 200 且 agentEnabled=false，未注册 Jot AI 工具 |
| 兼容性豁免 | 宿主 engine/version exemptions 为 `{}` |
| 前端日志 | 本次页面观测到的 error/warn 均为 0 |

安装日志中的 21.2 秒和 5.9 秒分别是 pnpm 为 Jot、Bridge 打印的摘要时间，不是本报告独立测量的完整向导耗时。本轮未单独持久保存每次包进程的 exitCode 字段；成功结论依据实际向导完成、后续启用、manager 回读、磁盘内容以及运行时／客户端检查，**不单凭 Done 文本**。

初始 fixture 只对 9 个确切的官方 alpha.4 包设置 release-age 例外，没有手工放行 Jot 或 Bridge。安装上述明确版本时，pnpm 自己分别增加了一条对应的 `minimumReleaseAgeExclude`，这是安装日志记录的普通路径；没有向宿主添加 engine/version 豁免。

## 清理

经正常 shutdown，Host 返回 0，独立退出记录确认 normalShutdownReturned=true。实际检查 owned Host PID 已消失，Web 与控制端口均已关闭；没有使用强杀兜底。隔离测试文件保留在本机，不属于本仓库。

辅助日志曾因并发快照写入出现中间 JSON 交错；正常 shutdown 后最终快照恢复可解析。本报告的安装证据另由控制接口只读快照、真实 UI 和独立磁盘校验取得，没有把损坏的中间快照当成通过证据。

生成脚本的 RED/GREEN 与覆盖率记录见 [pinned-index.tdd.md](testing/pinned-index.tdd.md)。本次安装后的脱敏运行时快照见 [runtime-proof-2026-10-16.json](runtime-proof-2026-10-16.json)。未提交认证 URL、控制令牌、私有 Home 或原始测试脚本。
