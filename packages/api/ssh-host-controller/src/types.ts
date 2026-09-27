import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

export type SshHostId = string
export type SshHostAuthMode = 'automatic' | 'config' | 'key' | 'password'
export type SshHostStatus = 'disconnected' | 'testing' | 'connecting' | 'connected' | 'failed'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'ssh-host/not-found': { readonly hostId: SshHostId }
    'ssh-host/rejected': { readonly hostId?: SshHostId }
    'ssh-directory-picker/unavailable': { readonly hostId: SshHostId }
    'ssh-directory-picker/unreadable': { readonly hostId: SshHostId; readonly path?: string }
    'ssh-directory-picker/create-failed': { readonly hostId: SshHostId; readonly path: string }
  }
}

export interface SshHostSaveRequest {
  readonly id?: SshHostId
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authMode: SshHostAuthMode
  readonly configAlias?: string
  readonly identityFile?: string
  readonly passwordRef?: CredentialRef | string
  readonly passphraseRef?: CredentialRef | string
  readonly defaultDirectory: string
  readonly node?: string
  readonly helperDirectory?: string
}

export interface SshHostValue {
  readonly id: SshHostId
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authMode: SshHostAuthMode
  readonly configAlias?: string
  readonly identityFile?: string
  readonly defaultDirectory: string
  readonly node?: string
  readonly helperDirectory?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly passwordConfigured: boolean
  readonly passphraseConfigured: boolean
  readonly status: SshHostStatus
  readonly error?: { readonly code?: string; readonly message: string }
}

export interface SshHostBaseline {
  readonly items: readonly SshHostValue[]
}

export type SshHostFollowFrame =
  | { readonly type: 'baseline'; readonly value: SshHostBaseline }
  | { readonly type: 'upsert'; readonly host: SshHostValue }
  | { readonly type: 'remove'; readonly hostId: SshHostId }

export interface SshDirectoryListRequest {
  readonly hostId: SshHostId
  readonly path?: string
}

export interface SshDirectoryListingValue {
  readonly listing: DirectoryListing
}
