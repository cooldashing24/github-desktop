import { join } from 'path'
import { spawn, SpawnOptions } from 'child_process'
import * as Fs from 'fs'
import { getDistPath, getExecutableName } from './dist-info'

const apparmorRestrictUsernsPath =
  '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'

function getBinaryPath(): string {
  const distPath = getDistPath()
  const productName = getExecutableName()

  if (process.platform === 'darwin') {
    return join(
      distPath,
      `${productName}.app`,
      'Contents',
      'MacOS',
      `${productName}`
    )
  } else if (process.platform === 'win32') {
    return join(distPath, `${productName}.exe`)
  } else if (process.platform === 'linux') {
    return join(distPath, productName)
  } else {
    console.error(
      `I dunno how to run on ${process.platform} ${process.arch} :(`
    )
    process.exit(1)
  }
}

/**
 * Determine Electron launch arguments for unpackaged local dev runs.
 *
 * On Ubuntu 24.04+, `kernel.apparmor_restrict_unprivileged_userns = 1` blocks
 * Electron's unprivileged user-namespace sandbox unless an installed AppArmor
 * profile covers the executable path.
 */
export function getLaunchArgs(
  platform: NodeJS.Platform = process.platform,
  apparmorUsernsPath: string = apparmorRestrictUsernsPath
): ReadonlyArray<string> {
  if (platform !== 'linux') {
    return []
  }

  try {
    // eslint-disable-next-line no-sync
    if (Fs.readFileSync(apparmorUsernsPath, 'utf8').trim() === '1') {
      return ['--no-sandbox']
    }
  } catch {
    return []
  }

  return []
}

/**
 * Spawn the built Desktop binary in development mode if it exists.
 *
 * Returns `null` when the target binary has not been built yet.
 */
export function run(spawnOptions: SpawnOptions) {
  const binaryPath = getBinaryPath()

  try {
    // eslint-disable-next-line no-sync
    const stats = Fs.statSync(binaryPath)
    if (!stats.isFile()) {
      return null
    }
  } catch {
    return null
  }

  const opts = Object.assign({}, spawnOptions)

  opts.env = Object.assign(opts.env || {}, process.env, {
    NODE_ENV: 'development',
  })

  return spawn(binaryPath, [...getLaunchArgs()], opts)
}
