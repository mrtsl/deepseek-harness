---
description: "局域网 SSH 主机管理器：持久主机记录、OpenSSH 启动配置和隔离执行上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh-hosts

[English](README.md) | 中文

## 概述

`ssh-hosts` 管理产品可见的局域网 SSH 主机。它保存不含密钥值的主机记录，在连接时解析凭据引用，准备 OpenSSH 启动配置，并为每台已连接主机发布隔离执行上下文。

本包不提供公网中继或自动发现服务。只要本地 OpenSSH 能登录目标主机，且目标为 Linux 或 macOS，该主机就可使用。

## 使用本包

在需要可选择远端环境的 Host 配置中组合 `SshHostManager`。调用 `save()` 保存主机，调用 `connect()` 创建隔离 SSH 执行栈，并通过 `execution(hostId)` 将文件系统、子进程、沙箱和终端消费者路由到该主机。

管理器报告 `disconnected`、`testing`、`connecting`、`connected` 和 `failed` 状态。密码和口令短语流程使用支持 askpass 的 OpenSSH 配置；秘密值保留在凭据提供方或私有 askpass 文件中，并从诊断信息中清除。

## 已知限制

首个版本仅限局域网、手动配置，并支持 Linux/macOS 目标。自动局域网发现、公网隧道和远端 Windows 目标有意不在范围内。
