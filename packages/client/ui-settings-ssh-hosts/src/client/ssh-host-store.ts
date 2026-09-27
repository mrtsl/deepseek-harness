import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  RemoteFailure, RemoteResult, SshHostFollowFrame, SshHostSaveRequest, SshHostValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export interface SshHostSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error: string | null
  readonly items: readonly SshHostValue[]
  readonly busyIds: ReadonlySet<string>
}

const INITIAL: SshHostSnapshot = { status: 'idle', error: null, items: [], busyIds: new Set() }

type SshHostContext = Pick<ClientContext, 'remote' | 'on'>

export class SshHostStore {
  readonly store: SnapshotStore<SshHostSnapshot> = createSnapshotStore(INITIAL)
  private loading: Promise<void> | undefined
  private readonly abort = new AbortController()
  private following = false
  private readonly disposeReset: () => void

  constructor(private readonly ctx: SshHostContext) {
    this.disposeReset = ctx.on('connection/reset', () => { void this.reload() })
  }

  dispose(): void {
    this.abort.abort()
    this.disposeReset()
  }

  ensure(): Promise<void> {
    return this.loading ??= this.load().finally(() => { this.loading = undefined })
  }

  async reload(): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), status: 'loading', error: null })
    await this.load()
  }

  private async load(): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), status: 'loading', error: null })
    try {
      const items = await remoteValue('sshHosts.list', this.ctx.remote.sshHosts.list())
      this.store.set({ status: 'ready', error: null, items, busyIds: new Set() })
      this.startFollow()
    } catch (error) {
      this.store.set({ ...this.store.getSnapshot(), status: 'error', error: messageOf(error) })
    }
  }

  private startFollow(): void {
    if (this.following) return
    this.following = true
    void this.follow()
  }

  private async follow(): Promise<void> {
    try {
      for await (const frame of this.ctx.remote.sshHosts.follow(this.abort.signal)) this.accept(frame)
    } catch (error) {
      if (!this.abort.signal.aborted) this.store.set({ ...this.store.getSnapshot(), status: 'error', error: messageOf(error) })
    }
  }

  accept(frame: SshHostFollowFrame): void {
    if (frame.type === 'baseline') {
      this.store.set({ ...this.store.getSnapshot(), status: 'ready', error: null, items: frame.value.items })
      return
    }
    if (frame.type === 'remove') {
      this.store.set({
        ...this.store.getSnapshot(),
        items: this.store.getSnapshot().items.filter(host => host.id !== frame.hostId),
      })
      return
    }
    this.upsert(frame.host)
  }

  async save(request: SshHostSaveRequest): Promise<void> {
    const host = await remoteValue('sshHosts.save', this.ctx.remote.sshHosts.save(request))
    this.upsert(host)
  }

  async delete(id: string): Promise<void> {
    await this.withBusy(id, async () => {
      await remoteValue('sshHosts.delete', this.ctx.remote.sshHosts.delete(id))
      this.store.set({ ...this.store.getSnapshot(), items: this.store.getSnapshot().items.filter(host => host.id !== id) })
    })
  }

  test(id: string): Promise<void> {
    return this.updateHost(id, () => this.ctx.remote.sshHosts.test(id), 'sshHosts.test')
  }

  connect(id: string): Promise<void> {
    return this.updateHost(id, () => this.ctx.remote.sshHosts.connect(id), 'sshHosts.connect')
  }

  disconnect(id: string): Promise<void> {
    return this.withBusy(id, async () => {
      await remoteValue('sshHosts.disconnect', this.ctx.remote.sshHosts.disconnect(id))
    })
  }

  private updateHost(id: string, call: () => Promise<RemoteResult<SshHostValue>>, operation: string): Promise<void> {
    return this.withBusy(id, async () => { this.upsert(await remoteValue(operation, call())) })
  }

  private async withBusy(id: string, run: () => Promise<void>): Promise<void> {
    this.setBusy(id, true)
    try {
      await run()
    } catch (error) {
      this.store.set({ ...this.store.getSnapshot(), error: messageOf(error) })
      throw error
    } finally {
      this.setBusy(id, false)
    }
  }

  private setBusy(id: string, busy: boolean): void {
    const snapshot = this.store.getSnapshot()
    const busyIds = new Set(snapshot.busyIds)
    if (busy) busyIds.add(id)
    else busyIds.delete(id)
    this.store.set({ ...snapshot, busyIds })
  }

  private upsert(host: SshHostValue): void {
    const snapshot = this.store.getSnapshot()
    const index = snapshot.items.findIndex(item => item.id === host.id)
    const items = index === -1
      ? [...snapshot.items, host]
      : snapshot.items.map(item => item.id === host.id ? host : item)
    this.store.set({ ...snapshot, status: 'ready', error: null, items })
  }
}

async function remoteValue<T>(operation: string, result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (settled.ok) return settled.value
  throw remoteFailure(operation, settled.error)
}

function remoteFailure(operation: string, error: RemoteFailure): Error {
  return new Error(`${operation} failed: ${error.code}: ${error.message}`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
