import { Context } from '@deepseek-ai/cordis'
import type { SshHostManager } from '@deepseek-ai/dsh-ssh-hosts/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { SshDirectoryPickerController } from '../src/directory-picker.ts'

function harness(manager: Partial<SshHostManager>) {
  const ctx = new Context()
  ctx.provide('sshHostManager', manager as SshHostManager)
  return new SshDirectoryPickerController(ctx)
}

async function refused(call: Promise<unknown>) {
  try {
    await call
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    if (failure === undefined) throw error
    return failure
  }
  throw new Error('expected call to fail')
}

describe('sshDirectoryPicker Remote controller', () => {
  it('maps manager list failures to ssh-directory-picker/unreadable', async () => {
    const picker = harness({
      directory: async () => { throw new Error('not an absolute POSIX path') },
    })

    const failure = await refused(picker.list('host-1', '../x', new AbortController().signal))

    expect(failure).toMatchObject({
      code: 'ssh-directory-picker/unreadable',
      details: { hostId: 'host-1', path: '../x' },
    })
  })

  it('rejects invalid child names before dispatching createDirectory', async () => {
    const createDirectory = vi.fn()
    const picker = harness({ createDirectory })

    const failure = await refused(picker.createDirectory('host-1', '/home/alice', 'bad/name'))

    expect(failure.code).toBe('gateway/bad-request')
    expect(createDirectory).not.toHaveBeenCalled()
  })
})
