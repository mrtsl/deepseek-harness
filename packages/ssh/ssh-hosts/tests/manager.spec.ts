import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SshHostManager } from '../src/index.ts'
import type { SshHostMount } from '../src/types.ts'

function fakeMount() {
  let failed: Error | undefined
  const mount: SshHostMount = {
    ctx: new Context(),
    dispose: vi.fn(async () => {}),
    failure: () => failed,
  }
  return {
    mount,
    fail(error: Error) { failed = error },
  }
}

describe('SSH host manager', () => {
  it('transitions through connecting and connected while mounting a saved host', async () => {
    const host = fakeMount()
    const observed: string[] = []
    const manager = new SshHostManager(new Context(), {}, {
      ids: () => 'host-1',
      now: () => '2026-09-27T00:00:00.000Z',
      mount: vi.fn(async () => {
        observed.push(manager.state('host-1').status)
        return host.mount
      }),
    })
    await manager.ready
    await manager.save({
      name: 'Lab',
      host: 'lab.local',
      port: 22,
      username: 'alice',
      authMode: 'automatic',
      defaultDirectory: '/home/alice',
    })

    const connected = await manager.connect('host-1')

    expect(observed).toEqual(['connecting'])
    expect(connected.status).toBe('connected')
    expect(manager.state('host-1').status).toBe('connected')
  })

  it('reports a connected mount as failed once the underlying transport fails', async () => {
    const host = fakeMount()
    const manager = new SshHostManager(new Context(), {}, {
      ids: () => 'host-1',
      now: () => '2026-09-27T00:00:00.000Z',
      mount: async () => host.mount,
    })
    await manager.ready
    await manager.save({
      name: 'Lab',
      host: 'lab.local',
      port: 22,
      username: 'alice',
      authMode: 'automatic',
      defaultDirectory: '/home/alice',
    })
    await manager.connect('host-1')

    host.fail(new Error('lost transport'))

    expect(manager.state('host-1')).toMatchObject({
      status: 'failed',
      error: { message: 'lost transport' },
    })
  })

  it('disposes a connected mount when deleting the host record', async () => {
    const host = fakeMount()
    const manager = new SshHostManager(new Context(), {}, {
      ids: () => 'host-1',
      now: () => '2026-09-27T00:00:00.000Z',
      mount: async () => host.mount,
    })
    await manager.ready
    await manager.save({
      name: 'Lab',
      host: 'lab.local',
      port: 22,
      username: 'alice',
      authMode: 'automatic',
      defaultDirectory: '/home/alice',
    })
    await manager.connect('host-1')

    await manager.delete('host-1')

    expect(host.mount.dispose).toHaveBeenCalledTimes(1)
    expect(manager.list()).toEqual([])
  })
})
