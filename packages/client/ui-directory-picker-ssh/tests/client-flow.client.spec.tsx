// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply, inject } from '../src/client/index.ts'
import { SshDirectoryFlow } from '../src/client/SshDirectoryFlow.tsx'
import { apply as nodeApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)

const HOLES = ['conversation.hero.workspace.sshDirectoryFlow', 'sidebar.workspaces.sshDirectoryFlow'] as const
const HOST_ID = 'host-1'
const HOME = '/home/alice'
const REPO = `${HOME}/repo`

const homeListing: DirectoryListing = {
  path: HOME,
  home: HOME,
  crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'alice', path: HOME, hidden: false }],
  entries: [{ name: 'repo', path: REPO, hidden: false }],
  truncated: false,
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listHosts = vi.fn(async () => ({ ok: true, value: [{ id: HOST_ID, status: 'connected' }] }))
  const list = vi.fn(async () => ({ ok: true, value: homeListing }))
  const createDirectory = vi.fn(async (hostId: string, path: string, name: string) => ({ ok: true, value: `${path}/${name}` }))
  ctx.provide('remote', { sshHosts: { list: listHosts }, sshDirectoryPicker: { list, createDirectory } } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, listHosts, list, createDirectory, declare }
}

function owner(overrides: Partial<DirectoryFlowOwnerProps> = {}): DirectoryFlowOwnerProps {
  return {
    open: true, busy: false,
    onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(),
    ...overrides,
  }
}

function t(key: string): string {
  return key
}

describe('directory-picker-ssh client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale'])
  })

  it('fills both SSH directory-flow holes and leaves with its fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(0)
  })

  it('drives SSH listing with the selected host id', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(HOLES[0])[0]!
    const injected = (entry.inject as () => {
      loadHost: () => Promise<{ id: string } | null>
      listDirectory: (hostId: string, path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
      createDirectory: (hostId: string, path: string, name: string) => Promise<string>
    })()

    await expect(injected.loadHost()).resolves.toMatchObject({ id: HOST_ID })
    expect(b.listHosts).toHaveBeenCalledOnce()
    const controller = new AbortController()
    await expect(injected.listDirectory(HOST_ID, undefined, controller.signal)).resolves.toBe(homeListing)
    expect(b.list).toHaveBeenCalledWith(HOST_ID, undefined, controller.signal)
    await expect(injected.createDirectory(HOST_ID, REPO, 'src')).resolves.toBe(`${REPO}/src`)
    expect(b.createDirectory).toHaveBeenCalledWith(HOST_ID, REPO, 'src')
  })

  it('adapts confirm and cancellation onto the SSH workspace payload', async () => {
    const props = owner()
    const listDirectory = vi.fn(async (): Promise<DirectoryListing> => homeListing)
    render(
      <SshDirectoryFlow
        {...props}
        hostId={HOST_ID}
        listDirectory={listDirectory}
        createDirectory={vi.fn(async () => '')}
        t={t}
      />,
    )

    const openButton = screen.getByRole<HTMLButtonElement>('button', { name: 'browser.open' })
    await waitFor(() => { expect(openButton.disabled).toBe(false) })
    fireEvent.click(openButton)
    expect(props.onPicked).toHaveBeenCalledWith({ path: HOME, environment: { kind: 'ssh', hostId: HOST_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'browser.cancel' }))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('creates directories through the SSH host id', async () => {
    const createDirectory = vi.fn(async () => `${REPO}/src`)
    render(
      <SshDirectoryFlow
        {...owner()}
        hostId={HOST_ID}
        listDirectory={vi.fn(async (): Promise<DirectoryListing> => ({
          ...homeListing,
          path: REPO,
          crumbs: [...homeListing.crumbs, { name: 'repo', path: REPO, hidden: false }],
          entries: [],
        }))}
        createDirectory={createDirectory}
        t={t}
      />,
    )

    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'browser.newFolder' }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'browser.newFolder' }))
    fireEvent.change(screen.getByLabelText('browser.folderName'), { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'browser.create' }))
    await waitFor(() => { expect(createDirectory).toHaveBeenCalledWith(HOST_ID, REPO, 'src') })
  })

  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
