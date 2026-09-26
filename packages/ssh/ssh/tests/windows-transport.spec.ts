/** Windows local transport: one loopback forward per stream, because Windows OpenSSH hosts no control master. */
import { EventEmitter } from 'node:events'
import { Duplex, PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SshRpcPeer } from '../src/protocol.ts'
import { SshConnection } from '../src/index.ts'
import type { Config, SshInternals } from '../src/index.ts'
import type { SshStreamEndpoint } from '../src/schemas.ts'

const transport = vi.hoisted(() => ({
  spawn: vi.fn(), exec: vi.fn(), connect: vi.fn(), tls: vi.fn(), directory: vi.fn(), remove: vi.fn(), server: vi.fn(),
}))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: transport.spawn, execFile: transport.exec }))
vi.mock('node:net', async original => ({ ...await original<typeof import('node:net')>(), createConnection: transport.connect, createServer: transport.server }))
vi.mock('node:tls', async original => ({ ...await original<typeof import('node:tls')>(), connect: transport.tls }))
vi.mock('node:fs/promises', () => ({ mkdtemp: transport.directory, rm: transport.remove }))

class Stream extends Duplex {
  override _read(): void {}
  override _write(_bytes: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback() }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void { callback(error) }
  disableRenegotiation(): void {}
}

class Child extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: string[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  ignoreTerm = false
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal)
    if (this.ignoreTerm && signal !== 'SIGKILL') return true
    this.exit(signal)
    return true
  }
  exit(signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    if (signal === null) this.exitCode = 0
    else this.signalCode = signal
    queueMicrotask(() => { this.emit('close', this.exitCode, this.signalCode) })
  }
}

interface LoopbackServer extends EventEmitter {
  listen: (port: number, host: string, callback: () => void) => void
  address: () => { port: number }
  close: (callback: () => void) => void
}

function loopbackServer(behaviour: { port?: number | undefined; error?: Error | undefined }): LoopbackServer {
  const server = new EventEmitter() as LoopbackServer
  server.listen = (_port, _host, callback) => {
    queueMicrotask(() => {
      if (behaviour.error === undefined) callback()
      else server.emit('error', behaviour.error)
    })
  }
  server.address = () => ({ port: behaviour.port ?? 0 })
  server.close = (callback) => { queueMicrotask(() => { callback() }) }
  return server
}

const config: Config = {
  host: 'test-alias', node: '/remote/node', helper: '/remote/helper.js', helperHash: 'a'.repeat(64), workspace: '/remote/workspace',
  requestTimeoutMs: 200, maxFrameBytes: 4096, maxPending: 8, leaseMs: 30_000,
}
const hello = {
  protocol: 1, hash: 'a'.repeat(64), platform: 'linux', nodeVersion: 'v24.19.0',
  node: '/canonical/node', root: '/tmp/remote-helper', workspace: '/canonical/workspace',
}
const endpoint: SshStreamEndpoint = { path: '/tmp/remote-helper/stream-0', capability: 'b'.repeat(64) }

function setup(options: {
  internals?: SshInternals
  config?: Partial<Config>
  port?: number
  portError?: Error
  connect?: 'ok' | 'refused-once' | 'refused-always' | 'hold'
  forwardExit?: 'immediate'
  ignoreTerm?: boolean
} = {}) {
  const ctx = new Context()
  const admin = new Child()
  const forwards: Child[] = []
  const raw: Stream[] = []
  const secured: Stream[] = []
  let spawned = 0
  let attempted = 0
  const helper = new SshRpcPeer(admin.stdin, admin.stdout, 4096, 8, async (method: string) => {
    if (method === 'hello') return hello
    if (method === 'heartbeat' || method === 'close') return null
    throw new Error(`unexpected helper request ${method}`)
  })
  transport.directory.mockResolvedValue('/virtual/ssh-windows')
  transport.remove.mockResolvedValue(undefined)
  transport.server.mockImplementation(() => loopbackServer({ port: options.port, error: options.portError }))
  transport.spawn.mockImplementation(() => {
    if (spawned++ === 0) return admin
    const child = new Child()
    child.ignoreTerm = options.ignoreTerm ?? false
    forwards.push(child)
    // Methods attach their listeners after `spawn` returns, so a queued exit still precedes the first connection.
    if (options.forwardExit === 'immediate') setTimeout(() => { child.exit() }, 0)
    return child
  })
  transport.connect.mockImplementation(() => {
    const socket = new Stream()
    raw.push(socket)
    const attempt = attempted++
    const behaviour = options.connect ?? 'ok'
    if (behaviour === 'hold') return socket
    if (behaviour === 'ok' || (behaviour === 'refused-once' && attempt > 0)) queueMicrotask(() => { socket.emit('connect') })
    else queueMicrotask(() => { socket.emit('error', new Error('connect ECONNREFUSED 127.0.0.1')) })
    return socket
  })
  transport.tls.mockImplementation((tlsOptions: { socket: Stream }) => {
    const stream = new Stream()
    secured.push(stream)
    // The TLS wrapper consumes the raw socket's errors, exactly as `tls.connect` does for its `socket` option.
    tlsOptions.socket.on('error', (error: Error) => { stream.destroy(error) })
    tlsOptions.socket.once('close', () => { stream.destroy() })
    stream.once('close', () => { tlsOptions.socket.destroy() })
    queueMicrotask(() => { stream.emit('secureConnect') })
    return stream
  })
  const service = new SshConnection(ctx, { ...config, ...options.config }, options.internals ?? { platform: 'win32' })
  onTestFinished(async () => {
    try { await service.dispose() } finally {
      for (const socket of [...raw, ...secured]) socket.destroy()
      admin.stderr.destroy(); helper.close(); admin.kill()
      await ctx.fiber.dispose()
      vi.restoreAllMocks()
      for (const mock of Object.values(transport)) mock.mockReset()
    }
  })
  return { service, admin, forwards }
}

describe('SSH Windows local transport', () => {
  it('forwards each stream through its own loopback child and never uses a control master', async () => {
    const test = setup({ port: 45_123 })
    await test.service.ready
    const socket = await test.service.connectStream(endpoint)
    expect(socket.destroyed).toBe(false)
    const argv = transport.spawn.mock.calls[1]?.[1] as string[]
    expect(argv).toContain('-N')
    expect(argv).toContain('127.0.0.1:45123:/tmp/remote-helper/stream-0')
    expect(argv).not.toContain('-M')
    expect(argv).not.toContain('-S')
    expect(transport.connect.mock.calls[0]?.[0]).toEqual({ host: '127.0.0.1', port: 45_123, allowHalfOpen: true })
    expect(transport.exec).not.toHaveBeenCalled()
  })

  it('passes askpass environment to per-stream forwarding children', async () => {
    const test = setup({
      port: 45_134,
      config: { batchMode: false, environment: { SSH_ASKPASS: '/tmp/dsh-askpass' } },
    })
    await test.service.ready
    await test.service.connectStream(endpoint)
    const argv = transport.spawn.mock.calls[1]?.[1] as string[]
    const options = transport.spawn.mock.calls[1]?.[2] as { env?: NodeJS.ProcessEnv }
    expect(argv).toContain('BatchMode=no')
    expect(argv).not.toContain('BatchMode=yes')
    expect(options.env).toMatchObject({ SSH_ASKPASS: '/tmp/dsh-askpass' })
  })

  it('retries a refused loopback connection while the forwarding child still runs', async () => {
    const test = setup({ port: 45_124, connect: 'refused-once' })
    await test.service.ready
    const socket = await test.service.connectStream(endpoint)
    expect(socket.destroyed).toBe(false)
    expect(transport.connect).toHaveBeenCalledTimes(2)
  })

  it('fails the stream when the loopback listener never accepts before its deadline', async () => {
    const test = setup({ port: 45_125, connect: 'refused-always', internals: { platform: 'win32', loopbackReadyTimeoutMs: 0 } })
    await test.service.ready
    await expect(test.service.connectStream(endpoint)).rejects.toThrow('ECONNREFUSED')
    expect(test.forwards[0]?.signals).toContain('SIGTERM')
  })

  it('fails the stream when the forwarding child exits before its listener accepts', async () => {
    const test = setup({ port: 45_126, connect: 'hold', forwardExit: 'immediate' })
    await test.service.ready
    await expect(test.service.connectStream(endpoint)).rejects.toThrow('exited before the stream was established')
  })

  it('fails the stream when no loopback port can be reserved', async () => {
    const test = setup({ portError: new Error('EACCES: permission denied, listen') })
    await test.service.ready
    await expect(test.service.connectStream(endpoint)).rejects.toThrow('EACCES')
  })

  it('refuses a remote stream path that would split the loopback forward specification', async () => {
    const test = setup({ port: 45_130 })
    await test.service.ready
    await expect(test.service.connectStream({ path: '/tmp/remote-helper/a:b', capability: 'b'.repeat(64) })).rejects.toThrow('invalid stream path')
    expect(transport.spawn).toHaveBeenCalledTimes(1)
  })

  it('escalates to SIGKILL when a forwarding child ignores termination', async () => {
    const test = setup({ port: 45_127, ignoreTerm: true })
    await test.service.ready
    const socket = await test.service.connectStream(endpoint)
    const forward = test.forwards[0] as Child
    socket.destroy()
    await vi.waitFor(() => { expect(forward.signals).toContain('SIGTERM') })
    await vi.waitFor(() => { expect(forward.signals).toContain('SIGKILL') }, { timeout: 2000 })
  })

  it('disposes an outstanding forwarding child and removes the private temporary directory', async () => {
    const test = setup({ port: 45_128 })
    await test.service.ready
    await test.service.connectStream(endpoint)
    const forward = test.forwards[0] as Child
    expect((Reflect.get(test.service, 'forwards') as Set<Child>).size).toBe(1)
    await test.service.dispose()
    expect(forward.signals).toContain('SIGTERM')
    expect(transport.remove).toHaveBeenCalledWith('/virtual/ssh-windows', { recursive: true, force: true })
  })

  it('tears down an outstanding forwarding child when the administrative channel closes', async () => {
    const test = setup({ port: 45_129 })
    await test.service.ready
    await test.service.connectStream(endpoint)
    const forward = test.forwards[0] as Child
    test.admin.exit()
    await vi.waitFor(() => { expect(forward.signals).toContain('SIGTERM') })
  })

  it('kills a forwarding child that is still connecting when the connection disposes', async () => {
    const test = setup({ port: 45_131, connect: 'hold' })
    await test.service.ready
    const settled = test.service.connectStream(endpoint).then(() => 'connected', (error: unknown) => error)
    await vi.waitFor(() => { expect(test.forwards).toHaveLength(1) })
    const forward = test.forwards[0] as Child
    await test.service.dispose()
    expect(forward.signals).toContain('SIGTERM')
    expect(await settled).toBeInstanceOf(Error)
  })
})
