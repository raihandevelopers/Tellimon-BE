import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const SYNC_SCRIPT = '/usr/local/bin/tellimon-sync.sh'

/** Push panel changes (blocked list, buyers, routing) to Asterisk files on this VPS. */
export async function syncAsteriskConfig() {
  try {
    await execFileAsync(SYNC_SCRIPT, [], {
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    return true
  } catch (err) {
    console.error('Asterisk config sync failed:', err.message || err)
    return false
  }
}

export function normalizePhoneNumber(number) {
  return String(number || '').replace(/\D/g, '')
}
