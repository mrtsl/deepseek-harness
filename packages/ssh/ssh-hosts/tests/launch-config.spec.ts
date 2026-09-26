import { describe, expect, it } from 'vitest'
import type { SshHostRecord } from '../src/types.ts'
import { buildOpenSshLaunchConfig, classifyOpenSshFailure } from '../src/launch-config.ts'

const baseRecord: SshHostRecord = {
  id: 'ssh-host-test',
  name: 'Lab host',
  host: 'lab.local',
  port: 22,
  username: 'alice',
  authMode: 'password',
  passwordRef: 'SSH_LAB_PASSWORD',
  defaultDirectory: '/home/alice',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
}

describe('OpenSSH launch config', () => {
  it('builds an askpass-capable product-owned host alias without leaking secrets to diagnostics', () => {
    const launch = buildOpenSshLaunchConfig(baseRecord, {
      password: 'secret password',
      askpassPath: '/tmp/dsh-ssh-hosts/askpass/password',
      configPath: '/tmp/dsh-ssh-hosts/config',
    })

    expect(launch.config.clientOptions).toContain('-F')
    expect(launch.config.clientOptions).toContain('/tmp/dsh-ssh-hosts/config')
    expect(launch.config.host).toMatch(/^dsh-host-/)
    expect(launch.config.batchMode).toBe(false)
    expect(launch.config.environment).toMatchObject({
      SSH_ASKPASS: '/tmp/dsh-ssh-hosts/askpass/password',
    })
    expect(launch.diagnostics('Permission denied for secret password')).not.toContain('secret password')
    expect(launch.configText).not.toContain('secret password')
  })

  it('keeps direct host entries strict and classifies host-key refusal diagnostics', () => {
    const launch = buildOpenSshLaunchConfig({ ...baseRecord, authMode: 'automatic', passwordRef: undefined }, {})

    expect(launch.config.host).toBe('alice@lab.local')
    expect(launch.config.batchMode).toBe(true)
    expect(launch.config.clientOptions).toEqual(expect.arrayContaining([
      '-p', '22',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ForwardAgent=no',
    ]))
    expect(classifyOpenSshFailure('Host key verification failed.')).toMatchObject({
      code: 'ssh-host/host-key-refused',
    })
  })
})
