import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

interface SshHostExecutionManager {
  execution(hostId: string): Context
}

const getService = (ctx: Context, name: string): unknown =>
  (ctx.get as unknown as (name: string) => unknown)(name)

/**
 * Resolve the execution provider context for one workspace.
 * Local and legacy workspaces use the host context; SSH workspaces use the
 * mounted host context owned by the LAN SSH host manager.
 */
export function executionContextForWorkspace(ctx: Context, workspace: Pick<Workspace, 'environment'>): Context {
  if (workspace.environment?.kind !== 'ssh') return ctx
  const manager = getService(ctx, 'sshHostManager') as SshHostExecutionManager | undefined
  if (manager === undefined) {
    throw new RemoteError('gateway/internal', 'SSH workspace execution is unavailable: no SSH host manager is mounted', {})
  }
  return manager.execution(workspace.environment.hostId)
}

/**
 * Install execution-world providers onto an unpublished Agent context.
 * The Agent still inherits all product services from the root context; only
 * filesystem, subprocess, and sandbox policy are overridden for the workspace.
 */
export function installExecutionProviders(agentCtx: Context, executionCtx: Context): void {
  for (const name of ['fs', 'subprocess', 'sandboxPolicy'] as const) {
    const service = getService(executionCtx, name)
    if (service !== undefined) {
      (agentCtx.provide as unknown as (name: string, service: unknown) => void)(name, service)
    }
  }
}
