// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SshHostDialog } from '../src/client/SshHostDialog.tsx'
import { en, type SshHostsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: SshHostsLocaleKey): string => en[key]

describe('SshHostDialog', () => {
  it('disables save and shows validation labels for invalid host fields', () => {
    render(<SshHostDialog open t={t} onClose={vi.fn()} onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(en.host), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(en.port), { target: { value: '70000' } })
    fireEvent.change(screen.getByLabelText(en.username), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(en.defaultDirectory), { target: { value: 'repo' } })

    expect(screen.getByText(en.invalidHost)).toBeTruthy()
    expect(screen.getByText(en.invalidPort)).toBeTruthy()
    expect(screen.getByText(en.invalidUsername)).toBeTruthy()
    expect(screen.getByText(en.invalidDefaultDirectory)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
  })
})
