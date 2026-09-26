# Personal fork synchronization and Windows packaging

English | [中文](README.zh.md)

The default branch, `dev`, owns personal changes and fork workflows. `master` contains only DeepSeek upstream history. Create feature branches from `dev` and merge them back through pull requests.

## Synchronize upstream

In GitHub Actions, select **Fork - Sync upstream**, select `dev`, and click **Run workflow**. The workflow requires `master` to be an ancestor of upstream `master`, fast-forwards it, then opens or reuses a `master → dev` PR. It creates no PR when `dev` already contains all upstream commits. Check affected behavior and use **Create a merge commit** to retain upstream ancestry; do not squash or rebase sync PRs.

For conflicts, create a temporary branch from `dev`, merge `origin/master`, resolve conflicts, and open a PR back to `dev`. Do not put personal commits on `master` or force-reset `dev`.

```sh
git fetch origin
git switch dev
git pull --ff-only origin dev
git switch -c sync/upstream
git merge origin/master
# Resolve conflicts, check and commit, then:
git push -u origin sync/upstream
```

Enable Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests. The workflow creates PRs without approving or merging them. It uses `GITHUB_TOKEN` by default. If GitHub rejects upstream updates containing workflow changes, configure the repository secret `FORK_SYNC_TOKEN` with a token limited to this repository and Contents, Pull requests, and Workflows write permissions. Never commit tokens. PRs created with the default `GITHUB_TOKEN` do not trigger another PR workflow; run Fork - Checks manually. Those checks cover personal packaging configuration, not all behavior affected by an upstream sync.

## Build a Windows installer

Select **Fork - Windows installer** in Actions, select `dev`, and click **Run workflow**. A GitHub-hosted Windows x64 runner installs locked dependencies, tests personal configuration, and invokes `package:win:x64:unsigned`. No local Windows installation, DeepSeek API key, or signing certificate is needed.

The build version combines the base version, Shanghai date, Actions run number, and attempt without modifying tracked version manifests. Download `deepseek-harness-<version>-win-x64` from the successful run's **Artifacts**, extract the ZIP, and run its `*-unsigned.exe`. Artifacts expire after 30 days; download them for longer storage. Failed builds retain packaging diagnostics for 7 days.

The personal app ID is `io.github.mrtsl.deepseek-harness`. `DSH_DESKTOP_MANDATORY_UPDATE_DISABLED=1` omits mandatory policy metadata and is accepted only for unsigned Windows packaging. Unsigned packages also omit official automatic-update feeds. Rebuild and install manually to update; nothing uploads to official distribution services. A separate app ID does not isolate user data or the `dsh://` protocol: upstream product names, data conventions, and protocol registration remain shared.

## Personal CI

**Fork - Checks** runs on pushes to `dev`, PRs targeting `dev`, and manual dispatch. It checks desktop packaging configuration and commit whitespace, not the whole Agent framework. Windows packaging additionally runs the upstream script's artifact verification.

Upstream workflows using private runners or official publication services remain in source for synchronization but are disabled in this fork's Actions settings. Disable newly introduced, unwanted upstream workflows after synchronization as well. Fork workflow definitions live in the adjacent `workflows/fork-*.yml` files.
