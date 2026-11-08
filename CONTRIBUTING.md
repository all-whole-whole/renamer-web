# 贡献指南

先谢谢你看这份文件。`renamer-web` 的目标很窄：**用最小的运行时把批量重命名这件事做对**。
所以这里的规则也围绕这个目标——不引入依赖、不为了框架而加抽象、落盘路径必须可回滚。

## 环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 只用 `node:` 内置模块，没有 `node_modules` |
| 操作系统 | Windows 10 / 11 | 原生文件夹对话框、长路径、`EPERM`/`EBUSY` 重试都依赖 Win32 |
| PowerShell | 5.1 | 启动脚本与原生对话框走 WinForms，非 PowerShell 7 |
| 浏览器 | 任意现代浏览器 | 只是普通标签页，不需要扩展或特殊 Profile |

非 Windows 平台能起服务、能跑大部分纯逻辑测试，但原生对话框与隐藏属性探测会降级——这是设计取舍，不是待修的 bug。

## 本地跑起来

```powershell
node bin\check.mjs       # 环境体检：Node / PowerShell / 端口 / 静态资源
node server\index.mjs    # 前台启动，浏览器打开 http://127.0.0.1:8758/
```

日常开发建议前台启动，`CTRL+C` 退出；`start.cmd` 是给最终用户的双击入口，会起后台进程。

## 改完必须跑测试

```powershell
node test\run.mjs
```

当前是 **55 项断言**，任何一项变红都不要提 PR。测试覆盖规则求值、冲突消解、两阶段落盘与回滚、
撤销回收、Host/Origin 校验、以及 10,000 项的吞吐预算。

新增规则时，除了 `server/renamer/rules/<name>.mjs`，请同时更新 `rules/index.mjs` 里的 schema
元数据（`label` / `summary` / `help` / `examples` / 逐字段 `hint`），并在 `test/run.mjs` 补断言。
前端编辑器完全由这份 schema 渲染，两边对不上就会立刻暴露。

## 零依赖是硬约束

CI 会直接失败的情况：

- `package.json` 里出现任何 `dependencies`
- 仓库里出现 `node_modules`
- 测试跑完留下脏文件（`git status` 非空）

需要某个能力时，优先用 `node:http` / `node:fs` / `node:path` / `node:vm` / `node:crypto` /
`node:child_process` 拼出来。确实需要外部库时请先开 Issue 讨论，不要在 PR 里直接加。

## 代码结构

目录职责见 [README 的「目录」一节](README.md#目录)。三条约定：

1. **一条规则一个文件**，只导出 `meta` 与 `apply`，不要在规则里读全局状态。
2. **落盘只走 `transaction.mjs`**，任何直接 `fs.rename` 的写法都不接受——两阶段改名是撤销能力的前提。
3. **前端不拼 HTML 字符串**，用 DOM API 建节点；文件名是不可信输入。

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)，描述用中文或英文都可以：

```
feat: 新增 randomize 规则
fix: 长路径下两阶段改名丢失扩展名
perf: 扫描 10k 项目时跳过重复 stat
docs: 补充 .rnp 预设格式说明
chore: 升级 CI 到 Node 24
```

一个提交只做一件事。格式化改动（换行、空白、重排）请单独成一次提交，别混进功能提交里。

## PR 检查清单

- [ ] `node test\run.mjs` 全绿
- [ ] 工作区干净，没有提交 `.tmp/`、日志、`node_modules/` 或个人配置
- [ ] 新增/修改的规则同步了 `rules/index.mjs` 的 schema 与示例
- [ ] 涉及落盘、撤销、并发窗口的改动，在 PR 描述里附复现步骤和实际输出
- [ ] 没有把真实路径、用户名、令牌写进代码、测试或截图

## 安全与隐私

这个工具会在本地读写真实文件，因此：

- 日志里出现绝对路径时，请把用户名部分换成占位符再贴出来。
- 不要在 Issue / PR 里贴 `.rnp` 预设的真实内容（可能含目录结构）。
- 服务默认只监听 `127.0.0.1`，`Host` 与 `Origin` 做精确校验。**不要**为了「方便手机访问」改成 `0.0.0.0`，
  那会把重命名能力暴露给同网段任何人。

## 报告问题

用 [Bug 模板](https://github.com/all-whole-whole/renamer-web/issues/new?template=bug_report.yml)，
把 `node bin\check.mjs` 的输出和 `.tmp\logs\server.err.log` 一并贴上。没有复现步骤的 issue 通常无法处理。
