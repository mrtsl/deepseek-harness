---
description: "Remote namespaces for LAN SSH host records, status updates and SSH directory browsing."
kind: "package-reference"
---

# SSH Host Controller

English

## Summary

`@deepseek-ai/dsh-api-ssh-host-controller` owns the Host `ctx.sshHostController` and `ctx.sshDirectoryPickerController` services. It exposes generated Client namespaces `sshHosts` and `sshDirectoryPicker` over API Gateway so UI surfaces can manage LAN SSH hosts and browse a connected host's POSIX directories.

The controller validates wire payloads, returns redacted host views only, and maps directory failures to stable `ssh-directory-picker/*` RemoteError codes.
