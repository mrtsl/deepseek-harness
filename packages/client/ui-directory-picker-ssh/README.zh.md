# @deepseek-ai/dsh-client-ui-directory-picker-ssh

[English](README.md) | 中文

面向局域网 SSH 工作区的客户端目录选择器。它填充 `ui-workspace` 暴露的 SSH 工作区目录流程 slot，复用 `ui-directory-picker-browse` 的应用内 Miller 浏览器，并把确认后的路径转换为带 `{ kind: "ssh", hostId }` 的工作区创建 payload。

该插件选择第一个已连接的 SSH 主机；如果没有，则回退到第一个已保存主机。主机记录和连接状态由 SSH host controller 与设置 UI 拥有。
