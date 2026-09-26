import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsDirEntry } from '@deepseek-ai/dsh-fs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  SshHostErrorView,
  SshHostId,
  SshHostManager as SshHostManagerShape,
  SshHostMount,
  SshHostRecord,
  SshHostSaveInput,
  SshHostStatus,
  SshHostView,
} from './types.ts'

export type {
  SshHostAuthMode,
  SshHostErrorView,
  SshHostId,
  SshHostMount,
  SshHostRecord,
  SshHostSaveInput,
  SshHostStatus,
  SshHostView,
} from './types.ts'
export { buildOpenSshLaunchConfig, classifyOpenSshFailure } from './launch-config.ts'
export { createAskpassScript } from './askpass.ts'

const credentialRefSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

export const sshHostRecordSchema: z.ZodType<SshHostRecord> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  authMode: z.enum(['automatic', 'config', 'key', 'password']),
  configAlias: z.string().min(1).optional(),
  identityFile: z.string().startsWith('/').optional(),
  passwordRef: credentialRefSchema.transform(value => credentialRef(value)).optional(),
  passphraseRef: credentialRefSchema.transform(value => credentialRef(value)).optional(),
  defaultDirectory: z.string().startsWith('/'),
  node: z.string().startsWith('/').optional(),
  helperDirectory: z.string().startsWith('/').optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) as z.ZodType<SshHostRecord>

export const sshHostsDomainSpec = defineDomain({
  name: 'ssh_hosts',
  version: 1,
  tables: { ssh_hosts: domainTable<SshHostId, SshHostRecord>(sshHostRecordSchema) },
})

export interface Config {}

export interface SshHostManagerInternals {
  readonly ids?: () => string
  readonly now?: () => string
  readonly mount?: (record: SshHostRecord) => Promise<SshHostMount>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sshHostManager: SshHostManager
  }
}

interface RuntimeState {
  status: SshHostStatus
  error?: SshHostErrorView
}

function asErrorView(error: unknown): SshHostErrorView {
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

function requirePosixDirectory(path: string): void {
  if (!path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\0')) {
    throw new Error(`SSH directory path must be an absolute POSIX path: '${path}'`)
  }
}

function crumbs(path: string): DirectoryEntry[] {
  const parts = path.split('/').filter(Boolean)
  const rows: DirectoryEntry[] = [{ name: '/', path: '/', hidden: false }]
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    rows.push({ name: part, path: current, hidden: part.startsWith('.') })
  }
  return rows
}

export class SshHostManager extends Service implements SshHostManagerShape {
  readonly ready: Promise<void>
  private domain?: Domain<typeof sshHostsDomainSpec>
  private table?: KvTable<SshHostId, SshHostRecord>
  private readonly records = new Map<SshHostId, SshHostRecord>()
  private readonly states = new Map<SshHostId, RuntimeState>()
  private readonly mounts = new Map<SshHostId, SshHostMount>()

  constructor(ctx: Context, _config: Config = {}, private readonly internals: SshHostManagerInternals = {}) {
    super(ctx, 'sshHostManager')
    this.ready = this.open()
    ctx.effect(() => async () => {
      await Promise.all([...this.mounts.values()].map(mount => mount.dispose()))
      await this.domain?.close()
    })
  }

  protected async [Service.init](): Promise<void> {
    await this.ready
  }

  list(): readonly SshHostView[] {
    return [...this.records.values()].map(record => this.view(record))
  }

  state(id: SshHostId): SshHostView {
    return this.view(this.requireRecord(id))
  }

  async save(input: SshHostSaveInput): Promise<SshHostView> {
    await this.ready
    const existing = input.id === undefined ? undefined : this.records.get(input.id)
    const now = this.now()
    const record: SshHostRecord = {
      id: input.id ?? this.id(),
      name: input.name.trim(),
      host: input.host.trim(),
      port: input.port,
      username: input.username.trim(),
      authMode: input.authMode,
      ...(input.configAlias === undefined ? {} : { configAlias: input.configAlias.trim() }),
      ...(input.identityFile === undefined ? {} : { identityFile: input.identityFile }),
      ...(input.passwordRef === undefined ? {} : { passwordRef: input.passwordRef }),
      ...(input.passphraseRef === undefined ? {} : { passphraseRef: input.passphraseRef }),
      defaultDirectory: input.defaultDirectory,
      ...(input.node === undefined ? {} : { node: input.node }),
      ...(input.helperDirectory === undefined ? {} : { helperDirectory: input.helperDirectory }),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    sshHostRecordSchema.parse(record)
    await this.put(record)
    this.states.set(record.id, this.states.get(record.id) ?? { status: 'disconnected' })
    return this.view(record)
  }

  async delete(id: SshHostId): Promise<void> {
    await this.ready
    await this.disconnect(id)
    this.records.delete(id)
    this.states.delete(id)
    await this.table?.delete(id)
  }

  async test(id: SshHostId): Promise<SshHostView> {
    await this.ready
    const record = this.requireRecord(id)
    this.states.set(id, { status: 'testing' })
    try {
      const mount = await this.mount(record)
      await mount.dispose()
      this.states.set(id, { status: 'disconnected' })
    } catch (error) {
      this.states.set(id, { status: 'failed', error: asErrorView(error) })
    }
    return this.view(record)
  }

  async connect(id: SshHostId): Promise<SshHostView> {
    await this.ready
    const record = this.requireRecord(id)
    const existing = this.mounts.get(id)
    if (existing !== undefined && existing.failure() === undefined) return this.view(record)
    if (existing !== undefined) await existing.dispose()
    this.states.set(id, { status: 'connecting' })
    try {
      const mount = await this.mount(record)
      this.mounts.set(id, mount)
      this.states.set(id, { status: 'connected' })
    } catch (error) {
      this.states.set(id, { status: 'failed', error: asErrorView(error) })
    }
    return this.view(record)
  }

  async disconnect(id: SshHostId): Promise<void> {
    await this.ready
    const mount = this.mounts.get(id)
    if (mount !== undefined) {
      this.mounts.delete(id)
      await mount.dispose()
    }
    if (this.records.has(id)) this.states.set(id, { status: 'disconnected' })
  }

  async directory(hostId: SshHostId, path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const record = this.requireRecord(hostId)
    const mount = this.requireMount(hostId)
    const targetPath = path ?? record.defaultDirectory
    requirePosixDirectory(targetPath)
    const target = await mount.ctx.fs.resolve(targetPath, signal === undefined ? undefined : { signal })
    const info = await mount.ctx.fs.stat(target, signal)
    if (info?.type !== 'directory') throw new Error(`cannot list SSH directory '${targetPath}'`)
    const entries: DirectoryEntry[] = (await mount.ctx.fs.listDir(target, signal))
      .filter(entry => entry.type === 'directory')
      .map((entry: FsDirEntry) => {
        const child = mount.ctx.fs.processPath(entry.target)
        return { name: entry.name, path: child, hidden: entry.name.startsWith('.') }
      })
      .sort((left: DirectoryEntry, right: DirectoryEntry) => left.name.localeCompare(right.name))
    return { path: mount.ctx.fs.processPath(target), home: record.defaultDirectory, crumbs: crumbs(targetPath), entries, truncated: false }
  }

  async createDirectory(hostId: SshHostId, path: string, name: string): Promise<string> {
    void hostId
    requirePosixDirectory(path)
    if (name.trim() === '' || name === '.' || name === '..' || name.includes('/')) throw new Error(`invalid SSH directory name '${name}'`)
    throw new Error('SSH directory creation requires a mounted remote mkdir provider')
  }

  async realpathDirectory(hostId: SshHostId, path: string): Promise<string> {
    const mount = this.requireMount(hostId)
    requirePosixDirectory(path)
    const target = await mount.ctx.fs.resolve(path)
    const info = await mount.ctx.fs.stat(target)
    if (info?.type !== 'directory') throw new Error(`SSH path is not a directory: '${path}'`)
    return mount.ctx.fs.processPath(target)
  }

  execution(hostId: SshHostId): Context {
    return this.requireMount(hostId).ctx
  }

  private async open(): Promise<void> {
    const storageDomain = this.ctx.get('storageDomain')
    if (storageDomain === undefined) return
    this.domain = await storageDomain.open(sshHostsDomainSpec)
    this.table = this.domain.table('ssh_hosts')
    for (const [id, record] of this.table.entries()) {
      this.records.set(id, record)
      this.states.set(id, { status: 'disconnected' })
    }
  }

  private async put(record: SshHostRecord): Promise<void> {
    this.records.set(record.id, record)
    await this.table?.put(record.id, record)
  }

  private view(record: SshHostRecord): SshHostView {
    const mountFailure = this.mounts.get(record.id)?.failure()
    const state = mountFailure === undefined
      ? this.states.get(record.id) ?? { status: 'disconnected' as const }
      : { status: 'failed' as const, error: asErrorView(mountFailure) }
    return {
      id: record.id,
      name: record.name,
      host: record.host,
      port: record.port,
      username: record.username,
      authMode: record.authMode,
      ...(record.configAlias === undefined ? {} : { configAlias: record.configAlias }),
      ...(record.identityFile === undefined ? {} : { identityFile: record.identityFile }),
      defaultDirectory: record.defaultDirectory,
      ...(record.node === undefined ? {} : { node: record.node }),
      ...(record.helperDirectory === undefined ? {} : { helperDirectory: record.helperDirectory }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      passwordConfigured: record.passwordRef !== undefined,
      passphraseConfigured: record.passphraseRef !== undefined,
      status: state.status,
      ...(state.error === undefined ? {} : { error: state.error }),
    }
  }

  private requireRecord(id: SshHostId): SshHostRecord {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`unknown SSH host '${id}'`)
    return record
  }

  private requireMount(id: SshHostId): SshHostMount {
    const mount = this.mounts.get(id)
    if (mount === undefined) throw new Error(`SSH host '${id}' is not connected`)
    const failure = mount.failure()
    if (failure !== undefined) throw failure
    return mount
  }

  private async mount(record: SshHostRecord): Promise<SshHostMount> {
    if (this.internals.mount === undefined) throw new Error('SSH host mounting is not configured')
    return await this.internals.mount(record)
  }

  private id(): string {
    return this.internals.ids?.() ?? randomUUID()
  }

  private now(): string {
    return this.internals.now?.() ?? new Date().toISOString()
  }
}

export default SshHostManager
