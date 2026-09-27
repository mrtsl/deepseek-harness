---
description: "局域网 SSH 主机记录、状态更新与 SSH 目录浏览的 Remote 命名空间。"
kind: "package-reference"
---

# SSH Host Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-ssh-host-controller` 拥有 Host 侧 `ctx.sshHostController` 与 `ctx.sshDirectoryPickerController` 服务。它通过 API Gateway 暴露生成的 Client 命名空间 `sshHosts` 与 `sshDirectoryPicker`，让 UI 可以管理局域网 SSH 主机并浏览已连接主机的 POSIX 目录。

控制器会校验 wire payload，只返回已脱敏的主机视图，并把目录失败映射成稳定的 `ssh-directory-picker/*` RemoteError code。
