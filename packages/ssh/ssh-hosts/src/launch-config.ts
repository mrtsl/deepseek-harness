import { createHash } from 'node:crypto'
import type { SshConnectionLaunchConfig, SshHostFailure, SshHostRecord, SshHostSecrets, SshProductLaunchConfig } from './types.ts'

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function directHost(record: SshHostRecord): string {
  if (record.authMode === 'config' && record.configAlias !== undefined && record.configAlias.trim() !== '') {
    return record.configAlias.trim()
  }
  return record.username.trim() === '' ? record.host.trim() : `${record.username.trim()}@${record.host.trim()}`
}

function generatedAlias(record: SshHostRecord): string {
  const digest = createHash('sha256').update(record.id).digest('hex').slice(0, 16)
  return `dsh-host-${digest}`
}

function redactSecrets(value: string, secrets: SshHostSecrets): string {
  let redacted = value
  for (const secret of [secrets.password, secrets.passphrase]) {
    if (secret !== undefined && secret !== '') redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

function baseOptions(record: SshHostRecord): string[] {
  return [
    '-p', String(record.port),
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ForwardAgent=no',
    ...(record.identityFile === undefined ? [] : ['-i', record.identityFile]),
  ]
}

function generatedConfig(record: SshHostRecord, alias: string): string {
  const lines = [
    `Host ${alias}`,
    `  HostName ${record.host.trim()}`,
    `  Port ${record.port}`,
    ...(record.username.trim() === '' ? [] : [`  User ${record.username.trim()}`]),
    '  StrictHostKeyChecking yes',
    '  ForwardAgent no',
    ...(record.identityFile === undefined ? [] : [`  IdentityFile ${shellSingleQuote(record.identityFile)}`]),
  ]
  return `${lines.join('\n')}\n`
}

export function buildOpenSshLaunchConfig(record: SshHostRecord, secrets: SshHostSecrets = {}): SshProductLaunchConfig {
  const needsGeneratedConfig = record.authMode === 'password' || (record.authMode === 'key' && secrets.passphrase !== undefined)
  const alias = needsGeneratedConfig ? generatedAlias(record) : directHost(record)
  const configPath = secrets.configPath ?? ''
  const askpassPath = secrets.askpassPath
  const secretBacked = secrets.password !== undefined || secrets.passphrase !== undefined
  const clientOptions = [
    ...(needsGeneratedConfig && configPath !== '' ? ['-F', configPath] : []),
    ...(!needsGeneratedConfig ? baseOptions(record) : []),
  ]
  const config: SshConnectionLaunchConfig = {
    host: alias,
    clientOptions,
    batchMode: !secretBacked,
    environment: askpassPath === undefined ? {} : {
      SSH_ASKPASS: askpassPath,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: 'none',
    },
    node: record.node ?? '/usr/bin/node',
    helper: `${record.helperDirectory ?? '/tmp/dsh-ssh-helper'}/helper.js`,
    helperHash: '0'.repeat(64),
    workspace: record.defaultDirectory,
  }
  const configText = needsGeneratedConfig ? generatedConfig(record, alias) : ''
  return {
    config,
    configText,
    diagnostics: message => redactSecrets(message, secrets),
  }
}

export function classifyOpenSshFailure(stderr: string): SshHostFailure | undefined {
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    return { code: 'ssh-host/host-key-refused', message: 'SSH host key was refused by OpenSSH' }
  }
  if (/permission denied/i.test(stderr)) {
    return { code: 'ssh-host/authentication-refused', message: 'SSH authentication was refused by OpenSSH' }
  }
  return undefined
}
