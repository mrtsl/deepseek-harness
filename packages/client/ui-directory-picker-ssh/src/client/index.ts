/** Client half of the LAN SSH directory-picker surface. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the SlotMap merge declaring the SSH directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SshDirectoryFlowInjected } from './SshDirectoryFlow.tsx'
import { SshDirectoryFlow } from './SshDirectoryFlow.tsx'
import { DICTIONARIES, LOCALE_NS } from './locales.ts'

/** Required services (cordis fiber inject): slots, Remote API, and locale. */
export const inject = ['slots', 'remote', 'locale']

/**
 * Client plugin body: register the SSH directory browser into both SSH
 * workspace-flow holes through `slots.inject()` because ui-workspace may
 * activate its declaring entries after this package.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    try {
      for (const [locale, dict] of DICTIONARIES) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'directory-picker-ssh: dialog dictionaries')

  const loadHost = async (): Promise<SshHostValue | null> => {
    const hosts = await remoteValue('sshHosts.list', ctx.remote.sshHosts.list())
    return hosts.find(host => host.status === 'connected') ?? hosts[0] ?? null
  }
  const injected = (): SshDirectoryFlowInjected => ({
    loadHost,
    listDirectory: (hostId, path, signal) =>
      remoteValue('sshDirectoryPicker.list', ctx.remote.sshDirectoryPicker.list(hostId, path, signal)),
    createDirectory: (hostId, path, name) =>
      remoteValue('sshDirectoryPicker.createDirectory', ctx.remote.sshDirectoryPicker.createDirectory(hostId, path, name)),
    t: ctx.locale.bind(LOCALE_NS),
  })
  ctx.slots.inject('conversation.hero.workspace.sshDirectoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.sshDirectoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.sshDirectoryFlow', inject: injected,
      }, SshDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.sshDirectoryFlow', inject: injected,
      }, SshDirectoryFlow)
    }))
}

async function remoteValue<T>(operation: string, result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (settled.ok) return settled.value
  throw remoteFailure(operation, settled.error)
}

function remoteFailure(operation: string, error: RemoteFailure): Error {
  return new Error(`${operation} failed: ${error.code}: ${error.message}`)
}
