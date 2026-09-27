import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SshHostManager, SshHostSaveInput, SshHostView } from '@deepseek-ai/dsh-ssh-hosts/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { SshHostController } from '../src/index.ts'

const view = (overrides: Partial<SshHostView> = {}): SshHostView => ({
  id: 'host-1',
  name: 'Lab',
  host: 'lab.local',
  port: 22,
  username: 'alice',
  authMode: 'automatic',
  defaultDirectory: '/home/alice',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  passwordConfigured: false,
  passphraseConfigured: false,
  status: 'disconnected',
  ...overrides,
})

function harness(manager: Partial<SshHostManager>) {
  const ctx = new Context()
  ctx.provide('sshHostManager', manager as SshHostManager)
  return { ctx, controller: new SshHostController(ctx) }
}

async function refused(call: Promise<unknown>): Promise<string> {
  try {
    await call
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    if (failure === undefined) throw error
    return failure.code
  }
  throw new Error('expected call to fail')
}

describe('sshHosts Remote controller', () => {
  it('trims saved host fields and never returns credential refs', async () => {
    let saved: SshHostSaveInput | undefined
    const { controller } = harness({
      save: async (input) => {
        saved = input
        return view({
          name: input.name,
          host: input.host,
          username: input.username,
          authMode: input.authMode,
          passwordConfigured: input.passwordRef !== undefined,
        })
      },
    })

    const result = await controller.save({
      name: ' Lab ',
      host: ' lab.local ',
      port: 22,
      username: ' alice ',
      authMode: 'password',
      passwordRef: 'SSH_LAB_PASSWORD',
      defaultDirectory: '/home/alice',
    })

    expect(saved).toMatchObject({
      name: 'Lab',
      host: 'lab.local',
      username: 'alice',
      passwordRef: credentialRef('SSH_LAB_PASSWORD'),
    })
    expect(JSON.stringify(result)).not.toContain('SSH_LAB_PASSWORD')
    expect(result.passwordConfigured).toBe(true)
  })

  it('rejects invalid save payloads before the manager sees them', async () => {
    const save = vi.fn()
    const { controller } = harness({ save })
    expect(await refused(controller.save({
      name: 'Lab',
      host: 'lab.local',
      port: 0,
      username: 'alice',
      authMode: 'automatic',
      defaultDirectory: '/home/alice',
    }))).toBe('gateway/bad-request')
    expect(save).not.toHaveBeenCalled()
  })

  it('streams a baseline and a status increment after connect', async () => {
    let current = view()
    const { controller } = harness({
      list: () => [current],
      connect: async () => {
        current = view({ status: 'connected' })
        return current
      },
    })
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'baseline', value: { items: [{ id: 'host-1', status: 'disconnected' }] } },
    })

    await controller.connect('host-1')

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'upsert', host: { id: 'host-1', status: 'connected' } },
    })
    abort.abort()
  })
})
