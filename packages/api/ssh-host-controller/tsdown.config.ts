import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-ssh-host-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
