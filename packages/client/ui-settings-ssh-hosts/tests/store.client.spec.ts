import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult, RemoteStreamHandle, SshHostFollowFrame, SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SshHostStore } from '../src/client/ssh-host-store.ts'

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })

function host(id: string, status: SshHostValue['status'] = 'disconnected'): SshHostValue {
  return {
    id, name: id, host: `${id}.lan`, port: 22, username: 'alice', authMode: 'automatic',
    defaultDirectory: '/home/alice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    passwordConfigured: false, passphraseConfigured: false, status,
  }
}

class Stream implements RemoteStreamHandle<SshHostFollowFrame, never> {
  private queue: SshHostFollowFrame[] = []
  private waiting: (() => void) | undefined
  disposed = false
  push(frame: SshHostFollowFrame): void {
    this.queue.push(frame)
    this.waiting?.()
  }
  async *[Symbol.asyncIterator](): AsyncIterator<SshHostFollowFrame> {
    while (!this.disposed) {
      const frame = this.queue.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await new Promise<void>((resolve) => { this.waiting = resolve })
      this.waiting = undefined
    }
  }
  send(_item: never): void {}
  end(): void {}
  dispose(): void { this.disposed = true; this.waiting?.() }
}

function bench(initial: readonly SshHostValue[] = [host('host-1')]) {
  const listeners = new Set<() => void>()
  const stream = new Stream()
  const list = vi.fn(async () => ok(initial))
  const ctx = {
    remote: {
      sshHosts: {
        list,
        follow: vi.fn(() => stream),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
    },
    on: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
  } as never
  const store = new SshHostStore(ctx)
  return { store, stream, list, reset: () => { for (const listener of listeners) listener() } }
}

describe('SshHostStore', () => {
  it('ensure reads the baseline and starts following changes', async () => {
    const b = bench([host('host-1')])
    await b.store.ensure()
    expect(b.list).toHaveBeenCalledOnce()
    expect(b.store.store.getSnapshot().items.map(item => item.id)).toEqual(['host-1'])
  })

  it('connection reset reloads the baseline', async () => {
    const b = bench([host('host-1')])
    await b.store.ensure()
    b.reset()
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(2) })
  })

  it('follow increments update one host status', async () => {
    const b = bench([host('host-1')])
    await b.store.ensure()
    b.stream.push({ type: 'upsert', host: host('host-1', 'connected') })
    await vi.waitFor(() => { expect(b.store.store.getSnapshot().items[0]?.status).toBe('connected') })
  })
})
