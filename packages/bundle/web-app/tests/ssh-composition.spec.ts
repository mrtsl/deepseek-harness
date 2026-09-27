/** Web bundle rows that make LAN SSH workspaces available by default. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function patchRows(): Array<{ id?: string; name?: string }> {
  const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('web-app patch must parse to a patch list')
  return parsed.flatMap((patch): Array<{ id?: string; name?: string }> =>
    typeof patch === 'object' && patch !== null
      ? (patch as { insert?: Array<{ id?: string; name?: string }> }).insert ?? []
      : [],
  )
}

it('ships LAN SSH host management, remotes, settings, and directory picking rows', () => {
  const rows = patchRows()
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'ssh-hosts', name: '@deepseek-ai/dsh-ssh-hosts' }),
    expect.objectContaining({ id: 'ssh-host-controller', name: '@deepseek-ai/dsh-api-ssh-host-controller' }),
    expect.objectContaining({ id: 'ui-settings-ssh-hosts', name: '@deepseek-ai/dsh-client-ui-settings-ssh-hosts' }),
    expect.objectContaining({ id: 'ui-directory-picker-ssh', name: '@deepseek-ai/dsh-client-ui-directory-picker-ssh' }),
  ]))
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-auto' }),
  ]))

  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  for (const name of [
    '@deepseek-ai/dsh-ssh-hosts',
    '@deepseek-ai/dsh-api-ssh-host-controller',
    '@deepseek-ai/dsh-client-ui-settings-ssh-hosts',
    '@deepseek-ai/dsh-client-ui-directory-picker-ssh',
  ]) {
    expect(manifest.dependencies).toHaveProperty(name)
  }
})
