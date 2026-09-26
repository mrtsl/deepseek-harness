import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AskpassBinding } from './types.ts'

function redact(value: string, secret: string): string {
  return secret === '' ? value : value.split(secret).join('[redacted]')
}

export async function createAskpassScript(root: string, secret: string): Promise<AskpassBinding> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(root, 'askpass.sh')
  const script = `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(secret)}\n`
  await writeFile(path, script, { mode: 0o600 })
  return {
    path,
    env: { SSH_ASKPASS: path, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: 'none' },
    argv: [path],
    diagnostics: message => redact(message, secret),
  }
}
