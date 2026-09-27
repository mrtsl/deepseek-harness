import { useEffect, useState } from 'react'
import { Button, Input, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SshHostAuthMode, SshHostSaveRequest, SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { SshHostsLocaleKey } from './locales.ts'
import css from './SshHostsSection.module.css'

type T = (key: SshHostsLocaleKey) => string

export interface SshHostDialogProps {
  readonly open: boolean
  readonly host?: SshHostValue | undefined
  readonly t: T
  readonly onClose: () => void
  readonly onSave: (request: SshHostSaveRequest) => Promise<void>
}

interface Draft {
  readonly name: string
  readonly host: string
  readonly port: string
  readonly username: string
  readonly defaultDirectory: string
  readonly authMode: SshHostAuthMode
}

function draftOf(host: SshHostValue | undefined): Draft {
  return {
    name: host?.name ?? '',
    host: host?.host ?? '',
    port: String(host?.port ?? 22),
    username: host?.username ?? '',
    defaultDirectory: host?.defaultDirectory ?? '/',
    authMode: host?.authMode ?? 'automatic',
  }
}

export function validateDraft(draft: Draft, t: T): readonly string[] {
  const errors: string[] = []
  const port = Number(draft.port)
  if (draft.host.trim() === '') errors.push(t('invalidHost'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(t('invalidPort'))
  if (draft.username.trim() === '') errors.push(t('invalidUsername'))
  if (!draft.defaultDirectory.startsWith('/')) errors.push(t('invalidDefaultDirectory'))
  return errors
}

export function SshHostDialog({ open, host, t, onClose, onSave }: SshHostDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(host))
  const [saving, setSaving] = useState(false)
  const errors = validateDraft(draft, t)
  useEffect(() => {
    if (open) setDraft(draftOf(host))
  }, [open, host])
  if (!open) return null
  const edit = (patch: Partial<Draft>): void => { setDraft(value => ({ ...value, ...patch })) }
  const save = async (): Promise<void> => {
    if (errors.length > 0 || saving) return
    setSaving(true)
    try {
      await onSave({
        ...(host === undefined ? {} : { id: host.id }),
        name: draft.name.trim() || draft.host.trim(),
        host: draft.host.trim(),
        port: Number(draft.port),
        username: draft.username.trim(),
        authMode: draft.authMode,
        defaultDirectory: draft.defaultDirectory,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={host === undefined ? t('add') : t('edit')} closeLabel={t('cancel')} className={css.dialog ?? ''}>
      <div className={css.form}>
        <label className={css.field}>
          <span>{t('name')}</span>
          <Input value={draft.name} onChange={(event) => { edit({ name: event.currentTarget.value }) }} />
        </label>
        <label className={css.field}>
          <span>{t('host')}</span>
          <Input value={draft.host} onChange={(event) => { edit({ host: event.currentTarget.value }) }} />
        </label>
        <label className={css.field}>
          <span>{t('port')}</span>
          <Input value={draft.port} inputMode="numeric" onChange={(event) => { edit({ port: event.currentTarget.value }) }} />
        </label>
        <label className={css.field}>
          <span>{t('username')}</span>
          <Input value={draft.username} onChange={(event) => { edit({ username: event.currentTarget.value }) }} />
        </label>
        <label className={css.field}>
          <span>{t('defaultDirectory')}</span>
          <Input value={draft.defaultDirectory} onChange={(event) => { edit({ defaultDirectory: event.currentTarget.value }) }} />
        </label>
        <div className={css.field}>
          <span>{t('authMode')}</span>
          <SegmentedControl
            id="ssh-host-auth-mode"
            label={t('authMode')}
            value={draft.authMode}
            onChange={(authMode) => { edit({ authMode }) }}
            options={[
              { value: 'automatic', label: t('authAutomatic') },
              { value: 'config', label: t('authConfig') },
              { value: 'key', label: t('authKey') },
              { value: 'password', label: t('authPassword') },
            ]}
          />
        </div>
        {errors.length > 0 && <div role="alert" className={css.errors}>{errors.map(error => <div key={error}>{error}</div>)}</div>}
        <div className={css.dialogActions}>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={errors.length > 0 || saving} onClick={() => { void save() }}>{t('save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
