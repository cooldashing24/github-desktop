import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getAvailableEditors } from '../../src/lib/editors/linux'
import { pathExists } from '../../src/lib/path-exists'
import { createTempDirectory } from '../helpers/temp'

async function createFakeExecutable(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, '')
}

describe('editors/linux', () => {
  if (!__WIN32__) {
    it('discovers ~/ and .local/ editors under os.homedir()', async t => {
      const tempHome = await createTempDirectory(t)
      const previousHome = process.env.HOME
      process.env.HOME = tempHome
      t.after(() => {
        if (previousHome === undefined) {
          delete process.env.HOME
        } else {
          process.env.HOME = previousHome
        }
      })

      const zedPath = join(tempHome, '.local', 'bin', 'zed')
      const vscodeFlatpakPath = join(
        tempHome,
        '.local',
        'share',
        'flatpak',
        'app',
        'com.visualstudio.code',
        'current',
        'active',
        'export',
        'bin',
        'com.visualstudio.code'
      )
      const pycharmToolboxPath = join(
        tempHome,
        '.local',
        'share',
        'JetBrains',
        'Toolbox',
        'scripts',
        'pycharm'
      )

      await createFakeExecutable(zedPath)
      await createFakeExecutable(vscodeFlatpakPath)
      await createFakeExecutable(pycharmToolboxPath)

      const found = await getAvailableEditors({
        pathExists: targetPath =>
          targetPath.startsWith(tempHome)
            ? pathExists(targetPath)
            : Promise.resolve(false),
      })

      assert.deepEqual(found, [
        { editor: 'Visual Studio Code', path: vscodeFlatpakPath },
        { editor: 'JetBrains PyCharm', path: pycharmToolboxPath },
        { editor: 'Zed', path: zedPath },
      ])
    })
  }

  it('expands ~/ and .local/ paths against homeDir without touching unexpanded literals', async () => {
    const homeDir = '/home/alice'
    const zedPath = join(homeDir, '.local', 'bin', 'zed')
    const riderPath = join(
      homeDir,
      '.local',
      'share',
      'JetBrains',
      'Toolbox',
      'scripts',
      'rider'
    )
    const existingPaths = new Set([zedPath, riderPath])

    const found = await getAvailableEditors({
      homeDir,
      pathExists: async targetPath => existingPaths.has(targetPath),
    })

    assert.deepEqual(found, [
      { editor: 'JetBrains Rider', path: riderPath },
      { editor: 'Zed', path: zedPath },
    ])
  })

  it('does not match literal unexpanded ~/ or .local/ paths', async () => {
    const existingPaths = new Set([
      '~/.local/bin/zed',
      '.local/share/JetBrains/Toolbox/scripts/rider',
    ])

    const found = await getAvailableEditors({
      homeDir: '/home/alice',
      pathExists: async targetPath => existingPaths.has(targetPath),
    })

    assert.deepEqual(found, [])
  })

  it('keeps absolute system paths unchanged', async () => {
    const existingPaths = new Set([
      '/usr/bin/nvim',
      '/snap/bin/code',
      '/var/lib/flatpak/app/com.vscodium.codium/current/active/export/bin/com.vscodium.codium',
    ])

    const found = await getAvailableEditors({
      homeDir: '/home/alice',
      pathExists: async targetPath => existingPaths.has(targetPath),
    })

    assert.deepEqual(found, [
      { editor: 'Neovim', path: '/usr/bin/nvim' },
      { editor: 'Visual Studio Code', path: '/snap/bin/code' },
      {
        editor: 'VSCodium',
        path: '/var/lib/flatpak/app/com.vscodium.codium/current/active/export/bin/com.vscodium.codium',
      },
    ])
  })
})
