# @deepseek-ai/dsh-client-ui-directory-picker-ssh

English | [中文](README.zh.md)

Client-side directory picker for LAN SSH workspaces. It fills the SSH workspace directory-flow slots exposed by `ui-workspace`, reuses the in-app Miller browser from `ui-directory-picker-browse`, and turns confirmed paths into workspace create payloads with `{ kind: "ssh", hostId }`.

The plugin selects the first connected SSH host, falling back to the first saved host. Host records and connection state are owned by the SSH host controller and settings UI.
