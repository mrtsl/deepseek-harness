---
description: "LAN SSH host manager for durable host records, OpenSSH launch setup and isolated execution contexts."
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh-hosts

English | [中文](README.zh.md)

## Summary

`ssh-hosts` owns product-visible LAN SSH hosts. It stores host records without secret values, resolves credential references at connection time, prepares OpenSSH launch configuration, and publishes one isolated execution context per connected host.

This package does not expose a public relay or discovery service. A host is usable when local OpenSSH can log in to it and the target is Linux or macOS.

## Use This Package

Compose `SshHostManager` in host profiles that need selectable remote environments. Call `save()` to store a host, `connect()` to create the isolated SSH execution stack, and `execution(hostId)` to route filesystem, subprocess, sandbox and terminal consumers through that host.

The manager reports `disconnected`, `testing`, `connecting`, `connected` and `failed` states. Password and passphrase flows use askpass-capable OpenSSH configuration; secrets remain in the credentials provider or private askpass files and are redacted from diagnostics.

## Known Limitations

The initial release is LAN-only, manually configured, and supports Linux/macOS targets. Automatic LAN discovery, public tunnels and remote Windows targets are intentionally out of scope.
