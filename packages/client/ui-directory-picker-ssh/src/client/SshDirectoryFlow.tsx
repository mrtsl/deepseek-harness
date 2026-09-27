import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DirectoryListing, SshHostValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { SshHostId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import { DirectoryBrowser } from '@deepseek-ai/dsh-client-ui-directory-picker-browse/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Injected face: SSH host selection, SSH browse calls, and localized copy. */
export interface SshDirectoryFlowInjected {
  /** Explicit host for tests or specialized hosts. */
  hostId?: SshHostId | undefined
  /** Select the SSH host to browse; the default plugin uses the first connected host, else the first host. */
  loadHost?: (() => Promise<SshHostValue | null>) | undefined
  /** List one directory level on the selected host. */
  listDirectory: (hostId: SshHostId, path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory on the selected host. */
  createDirectory: (hostId: SshHostId, path: string, name: string) => Promise<string>
  /** Localized dialog copy. */
  t: Translate
}

type HostState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly hostId: SshHostId }

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Flow occupant: loads/selects an SSH host, then adapts the reusable directory
 * browser so confirmed paths become SSH-scoped workspace create requests.
 * @param props - owner conversation plus the injected SSH browse face.
 * @returns the dialog element (renders nothing while closed or resolving a host).
 */
export function SshDirectoryFlow(props: DirectoryFlowOwnerProps & SshDirectoryFlowInjected): ReactElement | null {
  const [host, setHost] = useState<HostState>({ kind: 'idle' })
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const run = generation.current
    if (!props.open) {
      setHost({ kind: 'idle' })
      return
    }
    if (props.hostId !== undefined) {
      setHost({ kind: 'ready', hostId: props.hostId })
      return
    }
    if (props.loadHost === undefined) {
      props.onError(props.t('browser.noHost'))
      return
    }
    setHost({ kind: 'loading' })
    props.loadHost().then((value) => {
      if (run !== generation.current) return
      if (value === null) {
        setHost({ kind: 'idle' })
        props.onError(props.t('browser.noHost'))
        return
      }
      setHost({ kind: 'ready', hostId: value.id as SshHostId })
    }, (error: unknown) => {
      if (run !== generation.current) return
      setHost({ kind: 'idle' })
      props.onError(failureText(error))
    })
  }, [props.open, props.hostId, props.loadHost, props.onError, props.t])

  if (!props.open || host.kind !== 'ready') return null
  const hostId = host.hostId
  return createElement(DirectoryBrowser, {
    open: props.open,
    busy: props.busy,
    listDirectory: (path, signal) => props.listDirectory(hostId, path, signal),
    createDirectory: (path, name) => props.createDirectory(hostId, path, name),
    t: props.t,
    onOpen: path => props.onPicked({ path, environment: { kind: 'ssh', hostId } }),
    onClose: props.onCancel,
  })
}
