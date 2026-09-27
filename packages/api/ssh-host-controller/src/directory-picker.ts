/** Remote directory browser over a connected LAN SSH host. */

import { Context } from '@deepseek-ai/cordis'
import type { SshHostManager } from '@deepseek-ai/dsh-ssh-hosts/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { DirectoryListing, SshHostId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sshDirectoryPickerController: SshDirectoryPickerController
    sshHostManager: SshHostManager
  }
}

const createDirectoryRequestSchema = z.object({
  hostId: z.string().min(1),
  path: z.string(),
  name: z.string(),
}).refine(
  request => request.name.trim() !== '' && request.name !== '.' && request.name !== '..' && !/[/\\]/.test(request.name),
  { message: 'sshDirectoryPicker.createDirectory requires a single non-blank path segment name' },
)

export class SshDirectoryPickerController extends TypertRemoteService {
  static inject = ['sshHostManager']

  constructor(ctx: Context) {
    super(ctx, 'sshDirectoryPickerController', { namespace: 'sshDirectoryPicker' })
  }

  @Remote
  async list(hostId: SshHostId, path: string | undefined, signal: AbortSignal): Promise<DirectoryListing> {
    try {
      return await this.ctx.sshHostManager.directory(hostId, path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'SSH directory listing was aborted', {}, { cause: error })
      throw new RemoteError(
        'ssh-directory-picker/unreadable',
        messageOf(error),
        { hostId, ...(path === undefined ? {} : { path }) },
        { cause: error },
      )
    }
  }

  @Remote
  async createDirectory(hostId: SshHostId, path: string, name: string): Promise<string> {
    const request = createDirectoryRequestSchema.safeParse({ hostId, path, name })
    if (!request.success) {
      throw new RemoteError('gateway/bad-request', 'invalid payload for sshDirectoryPicker.createDirectory', { issues: request.error.issues })
    }
    try {
      return await this.ctx.sshHostManager.createDirectory(request.data.hostId, request.data.path, request.data.name)
    } catch (error: unknown) {
      throw new RemoteError(
        'ssh-directory-picker/create-failed',
        messageOf(error),
        { hostId: request.data.hostId, path: request.data.path },
        { cause: error },
      )
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default SshDirectoryPickerController
