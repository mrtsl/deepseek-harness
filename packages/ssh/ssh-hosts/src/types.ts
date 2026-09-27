import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker'

export interface SshConnectionLaunchConfig {
  readonly host: string
  readonly clientOptions?: readonly string[]
  readonly batchMode?: boolean
  readonly environment?: Record<string, string>
  readonly node: string
  readonly helper: string
  readonly helperHash: string
  readonly workspace: string
}

export type SshHostId = string

export type SshHostAuthMode = 'automatic' | 'config' | 'key' | 'password'

export type SshHostStatus = 'disconnected' | 'testing' | 'connecting' | 'connected' | 'failed'

export interface SshHostErrorView {
  readonly code?: string
  readonly message: string
}

export interface SshHostRecord {
  readonly id: SshHostId
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authMode: SshHostAuthMode
  readonly configAlias?: string
  readonly identityFile?: string
  readonly passwordRef?: CredentialRef
  readonly passphraseRef?: CredentialRef
  readonly defaultDirectory: string
  readonly node?: string
  readonly helperDirectory?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SshHostView extends Omit<SshHostRecord, 'passwordRef' | 'passphraseRef'> {
  readonly passwordConfigured: boolean
  readonly passphraseConfigured: boolean
  readonly status: SshHostStatus
  readonly error?: SshHostErrorView
}

export interface SshHostSaveInput {
  readonly id?: SshHostId
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authMode: SshHostAuthMode
  readonly configAlias?: string
  readonly identityFile?: string
  readonly passwordRef?: CredentialRef
  readonly passphraseRef?: CredentialRef
  readonly defaultDirectory: string
  readonly node?: string
  readonly helperDirectory?: string
}

export interface SshHostSecrets {
  readonly password?: string
  readonly passphrase?: string
  readonly askpassPath?: string
  readonly configPath?: string
}

export interface SshProductLaunchConfig {
  readonly config: SshConnectionLaunchConfig
  readonly configText: string
  readonly diagnostics: (stderr: string) => string
}

export interface SshHostFailure {
  readonly code: string
  readonly message: string
}

export interface AskpassBinding {
  readonly path: string
  readonly env: Record<string, string>
  readonly argv: readonly string[]
  readonly diagnostics: (message: string) => string
}

export interface SshHostMount {
  readonly ctx: Context
  dispose(): Promise<void>
  failure(): Error | undefined
}

export interface SshHostManager {
  list(): readonly SshHostView[]
  state(id: SshHostId): SshHostView
  save(input: SshHostSaveInput): Promise<SshHostView>
  delete(id: SshHostId): Promise<void>
  test(id: SshHostId): Promise<SshHostView>
  connect(id: SshHostId): Promise<SshHostView>
  disconnect(id: SshHostId): Promise<void>
  directory(hostId: SshHostId, path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  createDirectory(hostId: SshHostId, path: string, name: string): Promise<string>
  realpathDirectory(hostId: SshHostId, path: string): Promise<string>
  execution(hostId: SshHostId): Context
}
