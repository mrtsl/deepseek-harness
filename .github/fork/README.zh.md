# 个人 fork 的同步与 Windows 打包

[English](README.md) | 中文

本仓库的默认分支为 `dev`，保存个人修改与以下工作流；`master` 只保存 DeepSeek 上游提交。日常开发从 `dev` 创建功能分支，再通过 PR 合入 `dev`。

## 同步上游

在 GitHub 的 Actions 页面选择 **Fork - Sync upstream**，选择 `dev` 并点击 **Run workflow**。工作流仅允许 `master` 快进到 `deepseek-ai/deepseek-harness` 的 `master`，然后创建或复用 `master → dev` PR。没有新提交时不创建 PR。检查相关功能后，使用 **Create a merge commit** 合入，保留上游祖先关系，不使用 squash 或 rebase 合并同步 PR。

若发生冲突，从 `dev` 创建临时分支，merge `origin/master`，解决冲突后通过 PR 合入 `dev`。不要向 `master` 提交个人代码，也不要强制覆盖 `dev`。

```sh
git fetch origin
git switch dev
git pull --ff-only origin dev
git switch -c sync/upstream
git merge origin/master
# Resolve conflicts, check and commit, then:
git push -u origin sync/upstream
```

Actions 必须允许创建 PR：Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests。工作流只创建 PR，不会审批或自动合并。默认使用仓库的 `GITHUB_TOKEN`；如果 GitHub 拒绝推送含 workflow 修改的上游更新，可设置仓库 secret `FORK_SYNC_TOKEN`，使用仅授权本仓库、具备 Contents、Pull requests 和 Workflows 写权限的 token。不要把 token 写入文件。由默认 `GITHUB_TOKEN` 创建的 PR 不会自动触发另一轮 PR 工作流，需要手动运行 Fork - Checks；该检查只覆盖个人打包配置，不替代同步后各受影响功能的检查。

## 生成 Windows 安装包

在 Actions 中选择 **Fork - Windows installer**，选择 `dev` 并点击 **Run workflow**。工作流使用 GitHub 托管的 Windows x64 runner，安装锁定依赖、执行个人配置测试，然后调用现有 `package:win:x64:unsigned`。无需本地 Windows、DeepSeek API key 或签名证书。

构建版本由基础版本、上海日期、Actions run number 和 attempt 组成，不修改源码的版本清单。成功后在该次运行底部 **Artifacts** 下载 `deepseek-harness-<版本>-win-x64`，解压 ZIP 后运行其中的 `*-unsigned.exe`。产物保留 30 天；需要长期保存时自行下载归档。失败时检查日志和保留 7 天的 packaging diagnostics。

个人安装包的应用 ID 为 `io.github.mrtsl.deepseek-harness`，使用 `DSH_DESKTOP_MANDATORY_UPDATE_DISABLED=1` 省略强制更新配置；此开关只允许未签名 Windows 打包。未签名打包本身不生成官方自动更新 feed。更新个人版本时重新构建并手动安装，不上传到官方发布服务。应用 ID 独立不代表用户数据或 `dsh://` 协议隔离：它仍沿用上游产品名称、数据约定和协议，不应假定与官方安装并存互不影响。

## 个人 CI

**Fork - Checks** 在推送 `dev`、向 `dev` 提交 PR 或手动触发时运行，检查桌面打包配置及提交空白错误，不宣称覆盖整个 Agent 框架。Windows 打包还执行上游打包脚本内置的产物验证。

fork 不使用上游专用 runner、npm 发布及官方上传工作流。它们保留在源码以便同步，但在本仓库 Actions 设置中禁用。同步引入新的上游 workflow 后，也要在 Actions 页面禁用不需要的工作流。配置文件位于本目录相邻的 `workflows/fork-*.yml`。
