/** OpenSSH connection owner for one version-matched POSIX helper and its independent forwarded streams. */

import { spawn, execFile, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type AddressInfo, type Socket } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from './protocol.ts'
import { helloSchema, type SshStreamEndpoint } from './schemas.ts'
import { authenticateStream } from './stream-security.ts'

type Hello = z.infer<typeof helloSchema>

/** Deadline for a Windows loopback forward to accept its first connection; the child binds its listener after authentication. */
const SSH_LOOPBACK_READY_TIMEOUT_MS = 10_000

/** Delay between loopback connection attempts while a Windows forward binds its listener. */
const SSH_LOOPBACK_RETRY_DELAY_MS = 50

/** POSIX temporary root for the control-master socket; `sun_path` bounds its total length. */
const POSIX_TEMP_ROOT = '/tmp/dsh-ssh-'

/** Test hook: replace the client platform and the loopback readiness deadline. */
export interface SshInternals {
  /** Replaces `process.platform` for local transport selection (exercise the Windows transport from a POSIX host). */
  platform?: NodeJS.Platform
  /** Replaces the loopback forwarding readiness deadline (keep a retry-exhaustion test short). */
  loopbackReadyTimeoutMs?: number
}

/** Deployment-owned SSH identity and installed helper; no model argument selects these values. */
export interface Config {
  /** OpenSSH host alias, including its existing user, key and known-host configuration. */
  host: string
  /** Absolute remote Node executable. */
  node: string
  /** Absolute path to the installed, bundled helper entry. */
  helper: string
  /** SHA-256 of that bundled helper; mismatches refuse the connection. */
  helperHash: string
  /** Absolute remote default workspace. */
  workspace: string
  /** Optional preinstalled built PTC entry, paired with its expected digest. */
  bootstrapPath?: string
  /** SHA-256 of bootstrapPath; both fields must be supplied together. */
  bootstrapHash?: string
  /** Connection and administrative-request deadline, at most 2,147,483,647 milliseconds. */
  requestTimeoutMs?: number
  /** Maximum JSON payload bytes per helper request or response. */
  maxFrameBytes?: number
  /** Maximum ordinary requests; heartbeat and bounded resource cleanup have reserved capacity. */
  maxPending?: number
  /** Remote helper lease; loss of heartbeats starts remote managed cleanup. */
  leaseMs?: number
}

/**
 * Reserve an unused loopback port for one forwarded stream.
 * @returns the port the forwarding child binds; the child refuses to start when another process claims it first.
 */
async function allocateLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return address.port
}

/**
 * Resolve once a pending forwarding socket connects, and otherwise fail on its first error.
 * @param socket - the socket whose connection is pending.
 * @param signal - cancellation that destroys the pending socket.
 * @returns a promise settling with the connection outcome.
 */
function awaitStreamConnect(socket: Socket, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener('abort', aborted)
      socket.off('connect', connected)
      socket.off('error', failed)
      socket.off('close', closed)
    }
    const connected = (): void => { cleanup(); resolve() }
    const failed = (error: Error): void => { cleanup(); reject(error) }
    const closed = (): void => { failed(new Error('SSH connection closed before stream establishment')) }
    const aborted = (): void => { socket.destroy(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))) }
    socket.once('connect', connected)
    socket.once('error', failed)
    socket.once('close', closed)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/** A forwarding child's failure state; a refused loopback connection is retried only while its child lives. */
interface ForwardingChild {
  /** Rejects as soon as the child fails, so a wait never outlives its child. */
  readonly exited: Promise<never>
  /** The child's failure once it settled; a settled child ends the retry loop. */
  failure(): Error | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context { ssh: SshConnection }
}

/** One non-reconnecting SSH session; loss invalidates all active operations. */
export class SshConnection extends Service {
  static Config: schema<Config> = schema.object({
    host: schema.string().required(), node: schema.string().required(), helper: schema.string().required(),
    helperHash: schema.string().required(), workspace: schema.string().required(),
    bootstrapPath: schema.string(), bootstrapHash: schema.string(),
    requestTimeoutMs: schema.number().default(30_000), maxFrameBytes: schema.number().default(64 * 1024 * 1024),
    maxPending: schema.number().default(128), leaseMs: schema.number().default(30_000),
  })

  /** Verified remote helper coordinates; callers must await this before launch. */
  readonly ready: Promise<Hello>
  private rpc: SshRpcPeer | undefined
  private child: ChildProcessWithoutNullStreams | undefined
  private childClosed: Promise<void> | undefined
  private directory: string | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private closed = false
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private disposal: Promise<void> | undefined
  private failure: Error | undefined
  private sockets = new Set<Socket>()
  /** Forwarding children the Windows transport starts, one per established stream. */
  private readonly forwards = new Set<ChildProcess>()
  private nextSocket = 0
  /** Replaced by tests to exercise a client platform this host cannot provide. */
  readonly internals: SshInternals
  /** The selected local transport never changes after startup. */
  private readonly windows: boolean
  private readonly config: Required<Omit<Config, 'bootstrapPath' | 'bootstrapHash'>> & Pick<Config, 'bootstrapPath' | 'bootstrapHash'>
  private remote: Hello | undefined

  constructor(ctx: Context, config: Config, internals: SshInternals = {}) {
    super(ctx, 'ssh')
    this.internals = internals
    const platform = internals.platform ?? process.platform
    if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') throw new Error('SSH runtime requires a Linux, macOS, or Windows client')
    this.windows = platform === 'win32'
    this.config = z.object({
      host: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/),
      node: z.string().startsWith('/'), helper: z.string().startsWith('/'), helperHash: z.string().regex(/^[0-9a-f]{64}$/),
      workspace: z.string().startsWith('/'), requestTimeoutMs: z.number().int().positive().max(2_147_483_647),
      bootstrapPath: z.string().startsWith('/').optional(), bootstrapHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      maxFrameBytes: z.number().int().positive().max(64 * 1024 * 1024), maxPending: z.number().int().positive().max(128),
      leaseMs: z.number().int().min(3000).max(600_000),
    }).refine(value => (value.bootstrapPath === undefined) === (value.bootstrapHash === undefined), 'bootstrapPath and bootstrapHash must be paired')
      .parse(config) as typeof this.config
    this.ready = this.start()
    // Startup uses Node I/O, local validation, and Error-valued RPC failures.
    void this.ready.catch((error: unknown) => { this.fail(error as Error) })
    ctx.effect(() => () => this.dispose())
  }

  /** Hold plugin readiness until the remote identity and helper digest are verified. */
  async [Service.init](): Promise<void> { await this.ready }

  /** Verified remote Node executable for the paired PTC runtime. */
  get nodeExecutable(): string {
    if (this.remote === undefined) throw new Error('SSH helper is not ready')
    return this.remote.node
  }

  /** Verified preinstalled PTC entry; unconfigured runtimes fail before program execution. */
  get bootstrapPath(): string {
    if (this.remote === undefined || this.config.bootstrapPath === undefined) throw new Error('SSH PTC requires a verified bootstrapPath and bootstrapHash')
    return this.config.bootstrapPath
  }

  /**
   * Send a helper operation; cancellation never replays an ambiguous mutation.
   * @param method - the private helper operation.
   * @param params - JSON request fields validated by the helper.
   * @param result - response validation before returning provider-visible data.
   * @param signal - cancellation, which does not undo completed remote effects.
   * @param wait - allow a process observation to outlast the administrative deadline.
   * @returns the validated remote result.
   */
  async request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait: boolean = false): Promise<T> {
    this.assertOpen()
    await this.ready
    this.assertOpen()
    const bounded = wait ? signal : signal === undefined
      ? AbortSignal.timeout(this.config.requestTimeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    return (this.rpc as SshRpcPeer).request(method, params, result, bounded)
  }

  /**
   * Forward one authenticated stream through an independent SSH channel.
   * @param endpoint - private coordinates issued by this connection's helper.
   * @param signal - cancellation of allocation and the resulting socket.
   * @returns a paused socket; attach a consumer before resuming it.
   */
  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    return this.track(this.establishStream(endpoint, signal))
  }

  private async establishStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    const hello = await this.ready
    this.assertOpen()
    signal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    const remote = endpoint.path
    if (!remote.startsWith(`${hello.root}/`) || /[:\r\n\0]/u.test(remote)) throw new Error('SSH helper returned an invalid stream path')
    signal.throwIfAborted()
    if (this.windows) return await this.forwardLoopbackStream(endpoint, remote, signal)
    const local = join(this.directory as string, `s${this.nextSocket++}`)
    const forward = `${local}:${remote}`
    const cancelForward = async (): Promise<void> => {
      // An unavailable master already removed its forwarding listeners.
      if (!this.closed) await this.controlCommand(['-O', 'cancel', '-L', forward]).catch(() => {})
      await rm(local, { force: true })
    }
    try {
      await this.controlCommand(['-O', 'forward', '-o', 'ExitOnForwardFailure=yes', '-L', forward], signal)
    } catch (error) { await cancelForward(); throw error }
    signal.throwIfAborted()
    const socket = this.ownForwardedSocket(createConnection({ path: local, allowHalfOpen: true }), cancelForward)
    await awaitStreamConnect(socket, signal)
    return await this.acceptStream(socket, endpoint, signal)
  }

  /**
   * Forward one stream through a dedicated loopback listener. Windows OpenSSH supplies neither a control
   * master nor a local Unix-socket listener, so every stream carries its own connection; consumers still
   * receive a loopback TCP socket.
   * @param endpoint - private coordinates issued by this connection's helper.
   * @param remote - verified remote stream socket path.
   * @param signal - cancellation of port allocation, the forwarding child, and the resulting socket.
   * @returns the authenticated paused stream.
   */
  private async forwardLoopbackStream(endpoint: SshStreamEndpoint, remote: string, signal: AbortSignal): Promise<Socket> {
    const port = await allocateLoopbackPort()
    // A forwarding child owns no administrative channel, so it keeps the connection open and drains no diagnostics.
    const child = spawn('ssh', [
      '-T', '-N', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3',
      '-L', `127.0.0.1:${port}:${remote}`, this.config.host,
    ], { stdio: ['ignore', 'ignore', 'ignore'] })
    this.forwards.add(child)
    // The listener binds only after SSH authentication, so a child failure must end the wait instead of its deadline.
    let childFailure: Error | undefined
    const forwarding: ForwardingChild = {
      exited: new Promise<never>((_resolve, reject) => {
        const failed = (error: Error): void => { childFailure ??= error; reject(error) }
        child.once('error', failed)
        child.once('close', () => { failed(new Error('SSH forwarding child exited before the stream was established')) })
      }),
      failure: () => childFailure,
    }
    void forwarding.exited.catch(() => {})
    child.once('close', () => { this.forwards.delete(child) })
    const exited = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
    const cancelForward = async (): Promise<void> => {
      this.forwards.delete(child)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const force = setTimeout(() => { child.kill('SIGKILL') }, this.config.requestTimeoutMs)
      try { await exited } finally { clearTimeout(force) }
    }
    try {
      const socket = this.ownForwardedSocket(await this.connectLoopback(port, forwarding, signal), cancelForward)
      return await this.acceptStream(socket, endpoint, signal)
    } catch (error) { await cancelForward(); throw error }
  }

  /**
   * Connect to a forwarding child's loopback listener once it accepts.
   * @param port - the loopback port the child binds.
   * @param forwarding - the child's failure state, which ends the wait when the child fails.
   * @param signal - cancellation of the wait and the resulting socket.
   * @returns the connected socket.
   */
  private async connectLoopback(port: number, forwarding: ForwardingChild, signal: AbortSignal): Promise<Socket> {
    const deadline = Date.now() + (this.internals.loopbackReadyTimeoutMs ?? SSH_LOOPBACK_READY_TIMEOUT_MS)
    for (;;) {
      signal.throwIfAborted()
      const socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true })
      const connected = awaitStreamConnect(socket, signal)
      void connected.catch(() => {})
      try {
        await Promise.race([connected, forwarding.exited])
        return socket
      } catch (error) {
        socket.destroy()
        const failure = forwarding.failure()
        if (failure !== undefined) throw failure
        if (Date.now() >= deadline) throw error
        await new Promise<void>((resolve) => { setTimeout(resolve, SSH_LOOPBACK_RETRY_DELAY_MS) })
      }
    }
  }

  /** Track a forwarded socket and release its forward once the socket closes. */
  private ownForwardedSocket(socket: Socket, cancelForward: () => Promise<void>): Socket {
    this.sockets.add(socket)
    socket.once('close', () => {
      this.sockets.delete(socket)
      void this.track(cancelForward()).catch(() => {})
    })
    return socket
  }

  /**
   * Authenticate a connected forwarding socket with its private stream key.
   * @param socket - the connected forward.
   * @param endpoint - private coordinates carrying the per-stream key.
   * @param signal - cancellation of authentication and the resulting stream.
   * @returns the authenticated paused stream.
   */
  private async acceptStream(socket: Socket, endpoint: SshStreamEndpoint, signal: AbortSignal): Promise<Socket> {
    const authenticated = await authenticateStream(socket, endpoint.capability, this.config.requestTimeoutMs, signal)
    this.sockets.add(authenticated)
    authenticated.on('error', () => { authenticated.destroy() })
    authenticated.once('close', () => { this.sockets.delete(authenticated) })
    return authenticated
  }

  /** Tear down the helper's remote managed ranges before releasing the SSH master when reachable. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    this.lifetime.abort(new Error('SSH connection is closing'))
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    try {
      await this.ready.catch(() => {})
      if (this.failure === undefined) await this.rpc?.request('close', {}, z.null(), AbortSignal.timeout(this.config.requestTimeoutMs))
    } finally {
      this.rpc?.close()
      // TLS wrappers release their reads before their underlying sockets close.
      const socketClosures = [...this.sockets].reverse().map(socket => new Promise<void>((resolve) => {
        if (socket.closed) resolve()
        else { socket.once('close', () => { resolve() }); socket.destroy() }
      }))
      this.child?.kill('SIGTERM')
      for (const forward of this.forwards) forward.kill('SIGTERM')
      this.forwards.clear()
      const force = setTimeout(() => { this.child?.kill('SIGKILL') }, this.config.requestTimeoutMs)
      try { await this.childClosed } finally { clearTimeout(force) }
      await Promise.all(socketClosures)
      while (this.operations.size > 0) await Promise.allSettled([...this.operations])
      if (this.directory !== undefined) await rm(this.directory, { recursive: true, force: true })
    }
  }

  private controlPath(): string { return join(this.directory as string, 'master') }

  private assertOpen(): void {
    if (this.closed) throw new Error('SSH connection is closed')
    if (this.failure !== undefined) throw this.failure
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.finally(() => { this.operations.delete(operation) }).catch(() => {})
    return operation
  }

  private async controlCommand(args: string[], signal?: AbortSignal): Promise<void> {
    const signals = [this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const combined = AbortSignal.any(signals)
    combined.throwIfAborted()
    const result = Promise.withResolvers<undefined>()
    const command = execFile('ssh', ['-S', this.controlPath(), ...args, this.config.host], {
      signal: combined, maxBuffer: 64 * 1024,
    }, (error) => { if (error === null) result.resolve(undefined); else result.reject(error) })
    const closed = new Promise<void>((resolve) => { command.once('close', () => { resolve() }) })
    let force: NodeJS.Timeout | undefined
    const escalate = (): void => {
      force = setTimeout(() => { command.kill('SIGKILL') }, this.config.requestTimeoutMs)
      force.unref()
    }
    combined.addEventListener('abort', escalate, { once: true })
    try { await result.promise }
    finally {
      await closed
      combined.removeEventListener('abort', escalate)
      if (force !== undefined) clearTimeout(force)
    }
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    this.lifetime.abort(error)
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.rpc?.close(error)
    for (const socket of [...this.sockets].reverse()) socket.destroy(error)
    this.child?.kill('SIGTERM')
    for (const forward of this.forwards) forward.kill('SIGTERM')
  }

  private async start(): Promise<Hello> {
    // A control-master socket path lives in sun_path, so the POSIX client keeps its own short root.
    this.directory = await mkdtemp(this.windows ? join(tmpdir(), 'dsh-ssh-') : POSIX_TEMP_ROOT)
    if (this.closed) throw new Error('SSH connection closed before startup')
    const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
    const command = [this.config.node, '--disable-sigusr1', this.config.helper].map(quote).join(' ')
    const child = spawn('ssh', [
      '-T',
      // Windows OpenSSH has no connection multiplexing, so it cannot host a control master for later forwards.
      ...(this.windows ? [] : ['-M', '-S', this.controlPath(), '-o', 'ControlPersist=no']),
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
      '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3', this.config.host, command,
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.childClosed = new Promise((resolve) => { child.once('close', () => { resolve() }) })
    child.stderr.resume() // SSH diagnostics can contain configured paths; operation errors remain structured.
    child.once('error', (error) => { this.fail(error) })
    child.once('close', () => { this.fail(new Error('SSH helper disconnected; remote outcomes and cleanup are unknown')) })
    const rpc = new SshRpcPeer(child.stdout, child.stdin, this.config.maxFrameBytes, this.config.maxPending)
    this.rpc = rpc
    rpc.once('closed', (error) => { this.fail(error as Error) })
    const hello = await rpc.request('hello', {
      protocol: SSH_PROTOCOL_VERSION, workspace: this.config.workspace, leaseMs: this.config.leaseMs,
      ...(this.config.bootstrapPath === undefined ? {} : { bootstrapPath: this.config.bootstrapPath }),
    }, helloSchema, AbortSignal.timeout(this.config.requestTimeoutMs))
    if (hello.hash !== this.config.helperHash) throw new Error('SSH helper digest differs from the configured artifact')
    if (hello.bootstrapHash !== this.config.bootstrapHash) throw new Error('SSH PTC bootstrap digest differs from the configured artifact')
    this.remote = hello
    let heartbeatPending: Promise<unknown> | undefined
    this.heartbeat = setInterval(() => {
      heartbeatPending ??= rpc.request('heartbeat', {}, z.null(), AbortSignal.timeout(this.config.leaseMs / 2))
        .catch((error: unknown) => { this.fail(error as Error) })
        .finally(() => { heartbeatPending = undefined })
    }, Math.floor(this.config.leaseMs / 3))
    this.heartbeat.unref()
    return hello
  }
}

export default SshConnection
