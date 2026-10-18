# Totoro 的 DSH 插件索引

包含作者自己的两个 DeepSeek Harness 插件：随记 Jot 和 Bridge。索引直接指向 npm 官方 registry 上的已发布版本，不托管插件代码。

## 添加到 DSH

复制这个地址：

```text
https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-index/main/index.json
```

1. 使用提供自定义插件市场功能的 DSH。该功能在 `0.2.1-alpha.4` 加入；旧桌面版本如果没有 Discover，不要通过版本豁免强装新版市场组件。
2. 打开 **插件（Plugins）→ 实验性插件（Experimental plugins）→ 更多（More）**，启用 **自定义插件市场（Custom plugin markets）**。
3. 进入 **发现（Discover）→ 添加索引源（Add index source）**，粘贴上面的地址。
4. 选择 Jot 或 Bridge，核对安装确认里的包名、版本和 registry，再确认安装。

这是作者自托管的第三方源，不是 DSH 官方市场，也不代表其他社区的收录或审核。用户需要主动添加源；公开这个地址不会自动把条目推送到所有人的 Discover。

## 当前条目

<!-- current-releases:start -->

| 插件 | 版本 | 用途 |
| --- | --- | --- |
| [随记 Jot](https://github.com/Totoro-qaq/dsh-jot) | `0.2.14` | 对话旁边的备忘录，支持文本、待办、表格、搜索、附件和导出。AI 协作默认关闭。 |
| [Bridge](https://github.com/Totoro-qaq/dsh-plugin-bridge) | `0.5.0` | 预览、编辑交接摘要，再切换模式开启新会话；保留原会话，不搬运旧工具历史。 |

安装目标固定为 `dsh-jot@0.2.14` 和 `dsh-plugin-bridge@0.5.0`，registry 为 `https://registry.npmjs.org/`。宿主兼容范围和发布时间从这两个确切版本的 npm 元数据读取，DSH 在安装时会再次检查兼容性。

<!-- current-releases:end -->

已在全新的 DSH `0.2.1-alpha.4` 隔离 WebUI 中，从上面的公开地址完成添加源、安装和启用验收。Bridge doctor 为 13/13，Jot 页面可用且 AI 协作关闭。详见 [2026-10-16 验收记录](docs/acceptance-2026-10-16.md)；不将这轮 WebUI 结果扩展成原生桌面认证。

## 维护索引

需要 Node.js 22 或更新版本：

```sh
npm ci --ignore-scripts
npm run update
npm run check -- --online
npm test
```

`plugins.json` 保存显式版本和双语文案。仍可在确认插件已发布并完成相应验收后，手动修改版本、生成并提交 `index.json`。

### 发布后的自动同步

索引仓库每 15 分钟检查 Jot 和 Bridge 的发布记录（GitHub 队列可能延迟），也可在 Actions 手动运行 **Sync published plugin releases**。不需要在两个插件仓库配置跨仓库密钥。

自动化只接受这两个作者仓库的稳定版本，并同时核对：npm 精确版本、非废弃状态与 SHA-512；正式 GitHub Release；对应 tag 的 commit 和包清单；该版本成功完成的 npm 发布任务。失败、跳过、预发布、降级或证据缺失都不会更新市场。

核验后生成一个数据更新 PR，更新 `plugins.json`、`index.json`、本页版本表和 `releases.json` 发布凭据。版本相同且凭据未变时不重复提 PR。候选 PR 显式触发只读检查；检查运行可信 main 上的代码，不执行候选 PR 的脚本。合并步骤再次核对作者、文件白名单、生成结果和准确 SHA，仅在检查通过后合并，不自动批准其他 PR、不绕过保护规则。

仓库默认 Actions 权限保持只读。提 PR 和合并 job 单独请求索引仓库写权限；不保存个人 token。检查失败的 PR 保留，方便人工排查。`releases.json` 也会为已存在的两个版本补齐一次发布凭据，不会为演练发布新的 npm 包。

生成过程只读取 npm 元数据；不会安装或执行被列出的插件。生成失败时保留原索引。检查使用上游的 `@deepseek-ai/dsh-plugin-market-index` 解析器，并核对确切 npm 安装目标。索引自动化不发布 npm 包，只通过受检 PR 更新索引数据。

DSH 会缓存成功读取的索引；源更新后可在 Discover 中使用 **刷新（Refresh）**。不要使用 GitHub 的 `blob` 网页地址或带重定向的下载地址作为源。

## English

An author-maintained, third-party DSH index for **Jot** and **Bridge**.

Enable **Custom plugin markets** under **Plugins → Experimental plugins → More**, then open **Discover → Add index source** and paste:

```text
https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-index/main/index.json
```

Review the exact npm package, version and registry in the installation confirmation. This index is not an official DSH or community endorsement. Stable releases are proposed by an index-owned workflow every 15 minutes, only after matching the exact npm package, GitHub Release, tag commit and successful publisher job. Data-only PRs are independently checked before exact-SHA merging; failed checks leave the previous index in place. No cross-repository personal token or automatic npm publication is involved. Node.js 22+ is required only for maintaining this repository, not for adding the URL to an existing DSH installation.

## 上游格式

- [DSH 插件市场使用说明](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/docs/user/guide/plugin-market.zh.md)
- [官方参考生成器](https://github.com/deepseek-ai/deepseek-harness/tree/86a402200d95fecef4529d969836f1fe13c6cb0d/apps/plugin-market-generator)

本仓库只需要维护两个明确版本，因此使用小型元数据生成脚本和上游校验库，没有复制参考生成器，也不扫描其他作者的插件。
