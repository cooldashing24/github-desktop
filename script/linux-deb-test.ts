import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { createTempDirectory } from '../app/test/helpers/temp'
import {
  buildLinuxDeb,
  getLinuxDebFileName,
  toDebianArch,
  toDebianVersion,
} from './linux-deb'

const execFileP = promisify(execFile)

describe('linux deb version and naming', () => {
  it('normalizes semver pre-release tags to Debian tilde syntax', async () => {
    assert.equal(toDebianVersion('3.7.1-beta1'), '3.7.1~beta1')
    assert.equal(toDebianVersion('3.7.1-test.2'), '3.7.1~test.2')
    assert.equal(toDebianVersion('3.7.1'), '3.7.1')
  })

  it('maps x64 to amd64 and rejects unsupported architectures', async () => {
    assert.equal(toDebianArch('x64'), 'amd64')
    assert.throws(
      () => toDebianArch('arm64'),
      /Unsupported Linux Debian package architecture/
    )
    assert.equal(
      getLinuxDebFileName('3.7.1-beta1', 'x64'),
      'github-desktop_3.7.1~beta1_amd64.deb'
    )
  })
})

describe('buildLinuxDeb', { skip: process.platform !== 'linux' }, () => {
  it('builds an installable .deb with FHS layout, CLI wrapper routing, OAuth desktop schemes, AppArmor profile, and t64 deps', async t => {
    const root = await createTempDirectory(t)
    const distDir = join(root, 'desktop-linux-x64')
    const outputDir = join(root, 'out-debs')
    const extractDir = join(root, 'extracted')

    await mkdir(join(distDir, 'resources', 'app'), { recursive: true })
    await writeFile(
      join(distDir, 'desktop'),
      '#!/bin/sh\nprintf "DESKTOP|node=%s|args=%s\\n" "${ELECTRON_RUN_AS_NODE:-}" "$*"\n'
    )
    await chmod(join(distDir, 'desktop'), 0o755)
    await writeFile(join(distDir, 'chrome-sandbox'), 'sandbox')
    await chmod(join(distDir, 'chrome-sandbox'), 0o755)
    await writeFile(
      join(distDir, 'resources', 'app', 'package.json'),
      '{"name":"desktop"}\n'
    )

    const iconPath = resolve(__dirname, '../app/static/linux/icon-logo.png')

    const result = buildLinuxDeb({
      distDir,
      outputDir,
      version: '3.7.1-beta1',
      arch: 'x64',
      iconPath,
    })

    assert.equal(result.packageName, 'github-desktop')
    assert.equal(result.debVersion, '3.7.1~beta1')
    assert.equal(result.debArch, 'amd64')
    assert.equal(
      result.debPath,
      join(outputDir, 'github-desktop_3.7.1~beta1_amd64.deb')
    )

    const { stdout: info } = await execFileP(
      'dpkg-deb',
      ['--info', result.debPath],
      { encoding: 'utf8' }
    )
    assert.match(info, /^ Package: github-desktop$/m)
    assert.match(info, /^ Version: 3\.7\.1~beta1$/m)
    assert.match(info, /^ Architecture: amd64$/m)
    assert.match(info, /cooldashing24\/github-desktop/)
    assert.match(info, /libgtk-3-0t64 \| libgtk-3-0/)
    assert.match(info, /libasound2t64 \| libasound2/)
    assert.match(info, /libcups2t64 \| libcups2/)
    assert.match(info, /libatspi2\.0-0t64 \| libatspi2\.0-0/)
    assert.match(info, /libnss3/)
    assert.match(info, /libgbm1/)
    assert.match(info, /libdrm2/)
    assert.match(info, /libxkbcommon0/)
    assert.match(info, /libsecret-1-0/)
    assert.match(info, /libxss1/)
    assert.match(info, /libnotify4/)
    assert.match(info, /xdg-utils/)

    const { stdout: contents } = await execFileP(
      'dpkg-deb',
      ['--contents', result.debPath],
      { encoding: 'utf8' }
    )
    assert.match(contents, /\.\/usr\/lib\/github-desktop\/desktop/)
    assert.match(
      contents,
      /\.\/usr\/lib\/github-desktop\/resources\/app\/static\/github\.sh/
    )
    assert.match(
      contents,
      /\.\/usr\/bin\/github-desktop -> \/usr\/lib\/github-desktop\/resources\/app\/static\/github\.sh/
    )
    assert.match(
      contents,
      /\.\/usr\/share\/icons\/hicolor\/512x512\/apps\/github-desktop\.png/
    )
    assert.match(
      contents,
      /\.\/usr\/share\/applications\/github-desktop\.desktop/
    )
    assert.match(contents, /\.\/etc\/apparmor\.d\/github-desktop-app/)

    await mkdir(extractDir, { recursive: true })
    await execFileP('dpkg-deb', ['-x', result.debPath, extractDir])

    const extractedWrapperPath = join(
      extractDir,
      'usr',
      'lib',
      'github-desktop',
      'resources',
      'app',
      'static',
      'github.sh'
    )
    const extractedWrapperStat = await stat(extractedWrapperPath)
    assert.equal(extractedWrapperStat.mode & 0o755, 0o755)

    const symlinkLauncherPath = join(root, 'github-desktop-symlink')
    await symlink(extractedWrapperPath, symlinkLauncherPath)

    // Verify github.sh resolves symlinks via readlink -f, routes CLI arguments
    // via ELECTRON_RUN_AS_NODE=1, and passes x-github-* / --cli-* directly to
    // the desktop binary.
    const { stdout: cliInvocation } = await execFileP(
      symlinkLauncherPath,
      ['open', '/tmp/my-repo'],
      { encoding: 'utf8' }
    )
    assert.equal(
      cliInvocation.trim(),
      `DESKTOP|node=1|args=${join(
        extractDir,
        'usr',
        'lib',
        'github-desktop',
        'resources',
        'app',
        'cli.js'
      )} open /tmp/my-repo`
    )

    const { stdout: noArgInvocation } = await execFileP(
      symlinkLauncherPath,
      [],
      { encoding: 'utf8' }
    )
    assert.equal(
      noArgInvocation.trim(),
      `DESKTOP|node=1|args=${join(
        extractDir,
        'usr',
        'lib',
        'github-desktop',
        'resources',
        'app',
        'cli.js'
      )}`
    )

    const { stdout: urlInvocation } = await execFileP(
      symlinkLauncherPath,
      ['x-github-client://openRepo/https://github.com/desktop/desktop'],
      { encoding: 'utf8' }
    )
    assert.equal(
      urlInvocation.trim(),
      'DESKTOP|node=|args=x-github-client://openRepo/https://github.com/desktop/desktop'
    )

    const { stdout: cliFlagInvocation } = await execFileP(
      symlinkLauncherPath,
      ['--cli-open=/tmp/my-repo'],
      { encoding: 'utf8' }
    )
    assert.equal(
      cliFlagInvocation.trim(),
      'DESKTOP|node=|args=--cli-open=/tmp/my-repo'
    )

    const desktopEntry = await readFile(
      join(
        extractDir,
        'usr',
        'share',
        'applications',
        'github-desktop.desktop'
      ),
      'utf8'
    )
    assert.match(desktopEntry, /^Exec=\/usr\/lib\/github-desktop\/desktop %u$/m)
    assert.match(
      desktopEntry,
      /^MimeType=x-scheme-handler\/x-github-client;x-scheme-handler\/x-github-desktop-auth;x-scheme-handler\/x-github-desktop-dev-auth;$/m
    )

    const apparmorProfile = await readFile(
      join(extractDir, 'etc', 'apparmor.d', 'github-desktop-app'),
      'utf8'
    )
    assert.match(
      apparmorProfile,
      /profile github-desktop-app \/usr\/lib\/github-desktop\/desktop flags=\(unconfined\)/
    )
    assert.match(apparmorProfile, /\buserns,/)

    const extractedDesktopStat = await stat(
      join(extractDir, 'usr', 'lib', 'github-desktop', 'desktop')
    )
    assert.equal(extractedDesktopStat.mode & 0o755, 0o755)

    const { stdout: conffiles } = await execFileP(
      'dpkg-deb',
      ['--info', result.debPath, 'conffiles'],
      { encoding: 'utf8' }
    )
    assert.equal(conffiles.trim(), '/etc/apparmor.d/github-desktop-app')

    const { stdout: preinst } = await execFileP(
      'dpkg-deb',
      ['--info', result.debPath, 'preinst'],
      { encoding: 'utf8' }
    )
    assert.match(preinst, /IndexedDB\.pre-3\.7\.bak/)

    const { stdout: postinst } = await execFileP(
      'dpkg-deb',
      ['--info', result.debPath, 'postinst'],
      { encoding: 'utf8' }
    )
    assert.match(postinst, /apparmor_parser -r -T -W "\$APP_PROFILE"/)
    assert.match(postinst, /chmod 4755 "\$SANDBOX_BIN"/)
    assert.match(postinst, /update-desktop-database/)
    assert.match(postinst, /gtk-update-icon-cache/)

    const { stdout: postrm } = await execFileP(
      'dpkg-deb',
      ['--info', result.debPath, 'postrm'],
      { encoding: 'utf8' }
    )
    assert.match(postrm, /apparmor_parser -R/)
    assert.match(postrm, /update-desktop-database/)
    assert.match(postrm, /gtk-update-icon-cache/)
  })

  it('fails clearly when the distribution directory or desktop binary is missing', async t => {
    const root = await createTempDirectory(t)
    const iconPath = resolve(__dirname, '../app/static/linux/icon-logo.png')

    assert.throws(
      () =>
        buildLinuxDeb({
          distDir: join(root, 'missing'),
          outputDir: join(root, 'out'),
          version: '3.7.1',
          arch: 'x64',
          iconPath,
        }),
      /Distribution directory not found/
    )

    const emptyDist = join(root, 'empty-dist')
    await mkdir(emptyDist, { recursive: true })
    assert.throws(
      () =>
        buildLinuxDeb({
          distDir: emptyDist,
          outputDir: join(root, 'out'),
          version: '3.7.1',
          arch: 'x64',
          iconPath,
        }),
      /Expected Linux desktop binary/
    )
  })
})
