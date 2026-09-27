import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SshHostsSection, type SshHostsSectionInjected } from './SshHostsSection.tsx'
import { SshHostStore } from './ssh-host-store.ts'
import { en, zh, type SshHostsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.sshHosts': SshHostsLocaleKey
  }
}

export type { SshHostsSectionInjected, SshHostsSectionProps } from './SshHostsSection.tsx'
export type { SshHostSnapshot } from './ssh-host-store.ts'
export { SshHostStore } from './ssh-host-store.ts'
export type { SshHostsLocaleKey } from './locales.ts'

const NS = 'settings.sshHosts'

export const inject = ['slots', 'locale', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-ssh-hosts: dictionaries')
  const controller = new SshHostStore(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-ssh-hosts: store')
  const t = ctx.locale.bind(NS)
  const injected = (): SshHostsSectionInjected => ({
    controller,
    hooks: { hosts: controller.store },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ssh-hosts',
    order: 35,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SshHostsSection))
}
