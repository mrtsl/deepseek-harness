# LAN SSH Remote Environments Design

## Intent

DeepSeek Harness will support local-network SSH machines as first-class runtime environments. A user who can log in to a LAN host with ordinary SSH should be able to add that host in the product, choose a remote directory as a workspace, and run sessions, shell commands, terminals, file reads, file writes, diffs and tests on that host with the same interaction model used for local work.

This design deliberately excludes public relay, mobile takeover, cross-device availability, hosted tunnels and internet exposure. The host running DeepSeek Harness remains the controller, stores the user profile and session data, and connects only to SSH endpoints reachable from the local network or the user's configured network routes.

## Existing Context

The repository already contains a POSIX SSH execution family under `packages/ssh`: `dsh-ssh` owns one helper-backed OpenSSH connection, `fs-ssh` provides remote filesystem access, `subprocess-ssh` provides processes and terminals, and `sandbox-ssh` provides remote file-effect enforcement. The current package documentation describes a deployment-oriented model: an OpenSSH alias, preinstalled helper paths, explicit helper hashes, and a custom profile that swaps filesystem, subprocess and sandbox providers.

The Web product already has Host Remote namespaces for workspaces, sessions, directory picking, terminals, settings and credentials. `ui-workspace` uses a directory-picker slot to adopt a chosen host path as a workspace. The browse directory picker is browser-safe and already fits remote clients, but it lists the GUI host filesystem, not an SSH filesystem.

## Product Scope

The product will add a LAN SSH host manager. Users manage hosts in Settings and select a target environment when creating workspaces or starting sessions. The product copy should describe these as "SSH hosts" or "remote environments", not as provider packages.

The first release supports manually added hosts. Automatic scanning, Bonjour, LAN discovery and default import from `~/.ssh/config` are out of scope. A user may still select "SSH config" or "automatic" authentication behavior for a manually added host, so the product can use an existing alias or agent setup without discovering hosts.

Authentication must be permissive from the user's point of view: if the same machine can log in with `ssh`, the product should be able to use that route. The Host delegates transport to local OpenSSH and supports these modes:

- automatic: use OpenSSH defaults, `~/.ssh/config`, ssh-agent and host key policy;
- config alias: use a user-supplied Host alias directly;
- key: add a chosen identity file and optional passphrase handling;
- password: provide a stored password through a local askpass wrapper.

The model never sees credentials, askpass prompts, helper installation commands containing secrets, or raw SSH diagnostics that may include private paths. Credential writes use the existing credentials domain.

## User Experience

Settings gets a top-level "SSH Hosts" section. Its list rows show display name, host, user, port, default directory, last connection status and a compact status indicator: disconnected, testing, connected, failed. Each row has actions to test, edit, connect or disconnect, delete, and open the remote directory browser.

The add/edit dialog contains:

- display name;
- host or IP;
- port;
- username;
- authentication mode;
- SSH config alias when that mode is selected;
- identity file path when key mode is selected;
- password or passphrase fields when needed;
- default remote directory;
- remote Node command or path, defaulting to automatic detection.

The dialog should be dense and operational. It should avoid a marketing-style onboarding panel. It should use existing settings form primitives, icon buttons for row actions, a segmented control or select for authentication mode, and inline validation for missing host, invalid port, blank username, unreadable local identity path and non-absolute remote directory.

The workspace picker adds an environment step before directory selection when at least one SSH host exists: Local Computer plus configured SSH hosts. Local keeps the current directory-flow behavior. SSH opens a remote directory browser rooted at the host's default directory or home directory. The browser supports one-level listing and create-directory, matching the current browse picker interaction.

Workspace rows and session rows show a small environment label when the workspace is remote, for example `LAN · devbox`. Terminals and tool result presentations continue to use existing renderers, but any surface that names the execution location should read the workspace environment rather than implying local execution.

## Data Model

Add a Host-side `sshHostController` Remote namespace and a durable settings-backed host table. Each host record has an opaque id, display name, connection fields, authentication mode, credential references, default directory, optional Node override, created and updated timestamps, and non-secret status facts.

Credentials are not stored in the host table. Passwords, passphrases and future secret material are stored through the credentials service. The host table stores references only.

Workspace records include an execution environment reference. Local workspaces keep the current path-only behavior by treating a missing environment as local. SSH workspaces carry the SSH host id and remote path in the same durable workspace record. Remote workspace projections add enough data for client labels and target selection without exposing credentials.

Session creation inherits its workspace environment. Forks keep the parent session's workspace environment unless the user explicitly starts from another workspace. Session storage remains local to the Harness home for this design; remote hosts supply files and processes, not session persistence.

## Host Architecture

The product layer sits above the existing `dsh-ssh` connection provider. It owns product host records, credential resolution, connectivity tests, helper provisioning, and environment selection. The low-level provider remains responsible for the authenticated helper RPC, stream forwarding, filesystem, subprocess and sandbox capability implementations.

Add a multi-host manager service that can mount an isolated SSH execution stack per host id. Each mounted host owns isolated `ctx.ssh`, `ctx.fs`, `ctx.subprocess`, `ctx.sandbox` and terminal provider instances. Isolation is required because sibling hosts cannot share provider singleton service names.

Workspace and session operations resolve their execution stack from the workspace environment. A local workspace uses the default providers. An SSH workspace routes filesystem, subprocess, sandbox and terminal operations through that host's isolated context. Consumers should not construct raw `ssh ...` shell commands.

The current `dsh-ssh` config requires host alias, helper path, helper hash and workspace. The product manager resolves those fields from a product host record:

- build a temporary OpenSSH config or argv for host, port, user, identity file and alias selection;
- support askpass for password and passphrase flows without interactive terminal prompts;
- run a bounded probe to detect remote POSIX, Node and writable helper install location;
- install or update the helper under a product-owned remote directory outside workspaces and temporary sandbox roots;
- compute and store the expected helper hash from the shipped artifact;
- connect with the existing helper protocol.

The helper installation directory should default to a hidden product directory under the remote user's home, such as `~/.deepseek-harness/ssh-helper/<version>/`. Users may override it later if deployments need a managed path.

## Remote Directory Picking

Add an SSH directory-picker Remote namespace that lists directories via the selected host's remote filesystem. It returns the same `DirectoryListing` vocabulary used by the browse picker: crumbs, entries, hidden flags and truncation. The client reuses the existing directory browser UI through a separate SSH directory-flow occupant instead of adding environment parameters to the local directory-picker namespace.

The remote picker must reject relative paths and non-POSIX paths. This release supports Linux and macOS SSH targets. Windows SSH targets remain out of scope because the current SSH execution family is POSIX-oriented.

## Connection Lifecycle

`Test connection` performs authentication, remote platform check, Node detection, helper install or digest verification, and a directory stat for the default directory. It returns structured failure codes suitable for UI messages: authentication failed, host key refused, host unreachable, remote OS unsupported, Node missing, helper install failed, default directory unreadable and helper protocol mismatch.

`Connect` creates or reuses a mounted environment. `Disconnect` releases the helper and local forwards. Transport loss changes the row status to failed and invalidates active remote operations. The product does not replay ambiguous remote mutations after reconnect.

Long-running sessions keep using the mounted environment while it is healthy. If the connection fails mid-turn, existing tool and terminal error presentations show the failure and the workspace row reports the host as failed. The user can reconnect and retry manually.

## Security And Safety

The product does not weaken SSH host-key checks by default. For automatic mode it honors the user's OpenSSH configuration. For direct host entries it should default to strict checking and surface a clear host-key setup failure rather than silently trusting a new host. A future explicit "trust this host key" flow can be added, but this design does not require it.

ForwardAgent stays disabled for helper and stream connections unless a future setting explicitly asks for it. Credentials never enter model-visible logs. SSH diagnostics are summarized before they reach the UI. Full diagnostics, if kept for troubleshooting, stay in Host logs with existing redaction policy.

Remote helper installation is authenticated only by SSH plus the local shipped artifact hash. The helper directory must not be inside the chosen workspace. The product should refuse paths under workspace roots or world-writable temporary roots for helper installation.

## Testing

Unit tests cover host record validation, credential reference behavior, OpenSSH argv/config construction, askpass environment construction without leaking secrets, connection state transitions, workspace environment projection, and remote directory listing errors.

Composition tests boot a product profile with the SSH host manager and assert that enabling the settings section does not change local execution until a remote workspace is selected.

Client tests cover the settings card, add/edit dialog validation, connection status updates, environment selection in the workspace picker, remote workspace labels and failure messages.

Existing low-level SSH tests continue to own helper protocol and stream behavior. A keyless e2e test should use a fake SSH manager to prove product routing. Real SSH e2e remains opt-in behind environment variables, because CI cannot assume a LAN host.

## Deferred Work

Public relay, mobile control and cross-device state synchronization are out of scope.

Automatic LAN discovery, automatic `~/.ssh/config` import, remote Windows targets, Docker-over-SSH targets, jump-host UI, per-session environment switching, remote session-log storage and remote credential sync are out of scope.

## Chosen Implementation Boundaries

Workspace environment data belongs in the existing workspace registry record, not in a parallel metadata registry. The workspace registry already owns the durable relation between a workspace id and the path used for session creation, ordering and projection, so storing the environment there gives one source for local and SSH workspaces.

SSH directory browsing uses a separate Remote namespace. The local directory-picker namespace keeps its current host-filesystem contract, and the SSH flow adapts the existing browser UI to a remote host id without making local picker consumers understand remote execution.
