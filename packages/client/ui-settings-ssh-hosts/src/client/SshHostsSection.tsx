import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SshHostStatus, SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SshHostDialog } from './SshHostDialog.tsx'
import type { SshHostStore } from './ssh-host-store.ts'
import type { SshHostsLocaleKey } from './locales.ts'
import css from './SshHostsSection.module.css'

export interface SshHostsSectionInjected {
  readonly controller: SshHostStore
  readonly hooks: { readonly hosts: SshHostStore['store'] }
}

export type SshHostsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.sshHosts'>
  & InjectFace<SshHostsSectionInjected>

type T = (key: SshHostsLocaleKey) => string

function dot(status: SshHostStatus) {
  if (status === 'connected') return 'done'
  if (status === 'testing' || status === 'connecting') return 'ongoing'
  if (status === 'failed') return 'error'
  return 'idle'
}

function statusLabel(t: T, status: SshHostStatus): string {
  switch (status) {
    case 'connected': return t('statusConnected')
    case 'testing': return t('statusTesting')
    case 'connecting': return t('statusConnecting')
    case 'failed': return t('statusFailed')
    case 'disconnected': return t('statusDisconnected')
  }
}

export function SshHostsSection({ controller, useHosts, t }: SshHostsSectionProps) {
  const snapshot = useHosts(state => state)
  const [editing, setEditing] = useState<SshHostValue | null | 'new'>(null)
  useEffect(() => { void controller.ensure() }, [controller])
  return (
    <section className={css.root}>
      <header className={css.header}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.description}>{t('description')}</p>
        </div>
        <Button variant="primary" onClick={() => { setEditing('new') }}>{t('add')}</Button>
      </header>
      {snapshot.error !== null && <div className={css.banner} role="alert">{snapshot.error}</div>}
      {snapshot.items.length === 0
        ? <div className={css.empty}>{t('empty')}</div>
        : <div className={css.list}>
          {snapshot.items.map(host => (
            <article className={css.row} key={host.id}>
              <div className={css.status}><StateDot state={dot(host.status)} /><span>{statusLabel(t, host.status)}</span></div>
              <div className={css.main}>
                <div className={css.rowTitle}>{host.name}</div>
                <div className={css.meta}>{host.username}@{host.host}:{host.port} · {host.defaultDirectory}</div>
                {host.error !== undefined && <div className={css.errorLine}>{t('failed')}: {host.error.message}</div>}
              </div>
              <div className={css.actions}>
                <Button variant="outline" disabled={snapshot.busyIds.has(host.id)} onClick={() => { void controller.test(host.id) }}>{t('test')}</Button>
                {host.status === 'connected'
                  ? <Button variant="outline" disabled={snapshot.busyIds.has(host.id)} onClick={() => { void controller.disconnect(host.id) }}>{t('disconnect')}</Button>
                  : <Button variant="outline" disabled={snapshot.busyIds.has(host.id)} onClick={() => { void controller.connect(host.id) }}>{t('connect')}</Button>}
                <Button variant="outline" onClick={() => { setEditing(host) }}>{t('edit')}</Button>
                <Button variant="outline" disabled={snapshot.busyIds.has(host.id)} onClick={() => { void controller.delete(host.id) }}>{t('delete')}</Button>
              </div>
            </article>
          ))}
        </div>}
      <SshHostDialog
        open={editing !== null}
        host={editing === null || editing === 'new' ? undefined : editing}
        t={t}
        onClose={() => { setEditing(null) }}
        onSave={request => controller.save(request)}
      />
    </section>
  )
}
