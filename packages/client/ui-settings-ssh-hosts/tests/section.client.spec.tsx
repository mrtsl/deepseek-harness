// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SshHostsSection } from '../src/client/SshHostsSection.tsx'
import type { SshHostSnapshot } from '../src/client/ssh-host-store.ts'
import { en, type SshHostsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: SshHostsLocaleKey): string => en[key]

function host(overrides: Partial<SshHostValue> = {}): SshHostValue {
  return {
    id: 'host-1', name: 'devbox', host: 'devbox.lan', port: 22, username: 'alice', authMode: 'password',
    defaultDirectory: '/home/alice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    passwordConfigured: true, passphraseConfigured: false, status: 'failed',
    error: { message: 'Permission denied' },
    ...overrides,
  }
}

function useStore<T>(store: SnapshotStore<SshHostSnapshot>, selector: (state: SshHostSnapshot) => T): T {
  return selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
}

describe('SshHostsSection', () => {
  it('calls Test, hides password material, and shows failed row errors', () => {
    const store = createSnapshotStore<SshHostSnapshot>({
      status: 'ready', error: null, items: [host()], busyIds: new Set(),
    })
    const controller = {
      store,
      ensure: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    } as never

    render(
      <SshHostsSection
        controller={controller}
        useHosts={selector => useStore(store, selector)}
        t={t}
        close={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: en.test }))
    expect(controller.test).toHaveBeenCalledWith('host-1')
    expect(screen.queryByDisplayValue(/password/i)).toBeNull()
    expect(screen.queryByText(/secret/i)).toBeNull()
    expect(screen.getByText(/Permission denied/)).toBeTruthy()
  })
})
