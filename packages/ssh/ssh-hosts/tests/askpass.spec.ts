import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAskpassScript } from '../src/askpass.ts'

describe('SSH askpass binding', () => {
  it('creates a private askpass helper and keeps the secret out of argv and diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-askpass-test-'))
    const askpass = await createAskpassScript(root, 'secret passphrase')

    expect(askpass.env.SSH_ASKPASS).toBe(askpass.path)
    expect(askpass.argv.join('\n')).not.toContain('secret passphrase')
    expect(askpass.diagnostics('secret passphrase was rejected')).not.toContain('secret passphrase')
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect((await stat(askpass.path)).mode & 0o777).toBe(0o600)
    expect(await readFile(askpass.path, 'utf8')).toContain('printf')
  })
})
