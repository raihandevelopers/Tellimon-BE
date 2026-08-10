import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Safe Asterisk channel name (e.g. PJSIP/xolo-endpoint-000006b1). */
export function isSafeChannelId(channelId) {
  const id = String(channelId || '').trim()
  if (!id || id.length > 120) return false
  return /^[A-Za-z0-9][A-Za-z0-9/_.\-]*$/.test(id)
}

/**
 * Request hangup of an Asterisk channel via CLI.
 * Hanging up the inbound leg normally tears down the bridged outbound call too.
 */
export async function hangupAsteriskChannel(channelId) {
  const id = String(channelId || '').trim()
  if (!isSafeChannelId(id)) {
    throw new Error('INVALID_CHANNEL')
  }

  const { stdout, stderr } = await execFileAsync(
    'asterisk',
    ['-rx', `channel request hangup ${id}`],
    { timeout: 8_000, maxBuffer: 64 * 1024 }
  )
  const out = `${stdout || ''}${stderr || ''}`.trim()
  return { ok: true, output: out }
}
