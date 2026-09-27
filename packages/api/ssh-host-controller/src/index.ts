/** Host Remote owner for LAN SSH host records and connection status. */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SshHostManager, SshHostSaveInput, SshHostView } from '@deepseek-ai/dsh-ssh-hosts/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { SshDirectoryPickerController } from './directory-picker.ts'
import type {
  SshHostFollowFrame,
  SshHostId,
  SshHostSaveRequest,
  SshHostValue,
} from './types.ts'

export type * from './types.ts'
export { SshDirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sshHostManager: SshHostManager
    sshHostController: SshHostController
  }
}

const optionalCredentialRef = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional()

const saveRequestSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim(),
  authMode: z.enum(['automatic', 'config', 'key', 'password']),
  configAlias: z.string().trim().min(1).optional(),
  identityFile: z.string().startsWith('/').optional(),
  passwordRef: optionalCredentialRef,
  passphraseRef: optionalCredentialRef,
  defaultDirectory: z.string().startsWith('/'),
  node: z.string().startsWith('/').optional(),
  helperDirectory: z.string().startsWith('/').optional(),
})

export class SshHostController extends TypertRemoteService {
  static inject = ['sshHostManager']

  private readonly followers = new Set<SshHostFollower>()

  constructor(ctx: Context) {
    super(ctx, 'sshHostController', { namespace: 'sshHosts' })
    ctx.plugin(SshDirectoryPickerController)
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    })
  }

  @Remote
  list(): readonly SshHostValue[] {
    return this.ctx.sshHostManager.list().map(hostValue)
  }

  @Remote
  async save(request: SshHostSaveRequest): Promise<SshHostValue> {
    const parsed = saveRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', 'invalid payload for sshHosts.save', { issues: parsed.error.issues })
    }
    const data = parsed.data
    const input: SshHostSaveInput = {
      ...(data.id === undefined ? {} : { id: data.id }),
      name: data.name,
      host: data.host,
      port: data.port,
      username: data.username,
      authMode: data.authMode,
      ...(data.configAlias === undefined ? {} : { configAlias: data.configAlias }),
      ...(data.identityFile === undefined ? {} : { identityFile: data.identityFile }),
      ...(data.passwordRef === undefined ? {} : { passwordRef: credentialRef(data.passwordRef) }),
      ...(data.passphraseRef === undefined ? {} : { passphraseRef: credentialRef(data.passphraseRef) }),
      defaultDirectory: data.defaultDirectory,
      ...(data.node === undefined ? {} : { node: data.node }),
      ...(data.helperDirectory === undefined ? {} : { helperDirectory: data.helperDirectory }),
    }
    const host = hostValue(await this.ctx.sshHostManager.save(input))
    this.publish({ type: 'upsert', host })
    return host
  }

  @Remote
  async delete(hostId: SshHostId): Promise<void> {
    await this.ctx.sshHostManager.delete(hostId)
    this.publish({ type: 'remove', hostId })
  }

  @Remote
  async test(hostId: SshHostId): Promise<SshHostValue> {
    const host = hostValue(await this.ctx.sshHostManager.test(hostId))
    this.publish({ type: 'upsert', host })
    return host
  }

  @Remote
  async connect(hostId: SshHostId): Promise<SshHostValue> {
    const host = hostValue(await this.ctx.sshHostManager.connect(hostId))
    this.publish({ type: 'upsert', host })
    return host
  }

  @Remote
  async disconnect(hostId: SshHostId): Promise<void> {
    await this.ctx.sshHostManager.disconnect(hostId)
    const state = this.ctx.sshHostManager.state?.(hostId)
    if (state !== undefined) this.publish({ type: 'upsert', host: hostValue(state) })
  }

  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<SshHostFollowFrame> {
    signal.throwIfAborted()
    const follower = new SshHostFollower()
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: { items: this.list() } }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private publish(frame: Exclude<SshHostFollowFrame, { readonly type: 'baseline' }>): void {
    for (const follower of this.followers) follower.push(frame)
  }
}

function hostValue(view: SshHostView): SshHostValue {
  return {
    id: view.id,
    name: view.name,
    host: view.host,
    port: view.port,
    username: view.username,
    authMode: view.authMode,
    ...(view.configAlias === undefined ? {} : { configAlias: view.configAlias }),
    ...(view.identityFile === undefined ? {} : { identityFile: view.identityFile }),
    defaultDirectory: view.defaultDirectory,
    ...(view.node === undefined ? {} : { node: view.node }),
    ...(view.helperDirectory === undefined ? {} : { helperDirectory: view.helperDirectory }),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    passwordConfigured: view.passwordConfigured,
    passphraseConfigured: view.passphraseConfigured,
    status: view.status,
    ...(view.error === undefined ? {} : { error: view.error }),
  }
}

class SshHostFollower {
  private readonly frames: SshHostFollowFrame[] = []
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: SshHostFollowFrame): void {
    if (this.closed) return
    this.frames.push(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<SshHostFollowFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          signal.removeEventListener('abort', finish)
          if (this.waiting === finish) this.waiting = undefined
          resolve()
        }
        this.waiting = finish
        signal.addEventListener('abort', finish, { once: true })
        if (signal.aborted || this.closed || this.frames.length > 0) finish()
      })
    }
  }
}

export default SshHostController
