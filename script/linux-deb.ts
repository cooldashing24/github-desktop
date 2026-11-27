/* eslint-disable no-sync */

import { execFileSync } from 'child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { DesktopPackageArch } from './packager-options'

/**
 * Debian package name for GitHub Desktop.
 *
 * Used for the `.deb` filename, control metadata, and install paths.
 */
export const linuxDebPackageName = 'github-desktop'

/**
 * AppArmor profile name and filename under `/etc/apparmor.d/`.
 *
 * Uses a distinct name from Ubuntu's built-in `github-desktop` profile
 * shipped by the `apparmor` package to avoid `dpkg` file conflicts while
 * granting `userns` to `/usr/lib/github-desktop/desktop`.
 */
export const linuxDebAppArmorProfileName = 'github-desktop-app'

/**
 * Debian package maintainer metadata string.
 *
 * Identifies the fork maintainer in `DEBIAN/control`.
 */
export const linuxDebMaintainer =
  'cooldashing24 <cooldashing24@users.noreply.github.com>'

/**
 * Upstream fork homepage URL for the Debian package.
 *
 * Included in `DEBIAN/control` `Homepage` metadata.
 */
export const linuxDebHomepage =
  'https://github.com/cooldashing24/github-desktop'

/**
 * Runtime Debian package dependencies for Ubuntu 24.04+.
 *
 * Includes `t64` library alternatives compatible with Ubuntu 24.04 alongside
 * fallback package names.
 */
export const linuxDebDepends: ReadonlyArray<string> = [
  'libgtk-3-0t64 | libgtk-3-0',
  'libasound2t64 | libasound2',
  'libcups2t64 | libcups2',
  'libatspi2.0-0t64 | libatspi2.0-0',
  'libnss3',
  'libgbm1',
  'libdrm2',
  'libxkbcommon0',
  'libsecret-1-0',
  'libxss1',
  'libnotify4',
  'xdg-utils',
]

/**
 * Custom URI schemes registered in the `.desktop` entry.
 *
 * Routes OAuth callbacks and "Open in GitHub Desktop" links into the app.
 */
export const linuxDebMimeTypes: ReadonlyArray<string> = [
  'x-scheme-handler/x-github-client',
  'x-scheme-handler/x-github-desktop-auth',
  'x-scheme-handler/x-github-desktop-dev-auth',
]

/**
 * Inputs required to build a native `.deb` package on Linux.
 *
 * Specifies the packaged distribution directory, output directory, version,
 * architecture, and application icon path.
 */
export interface ILinuxDebPackageOptions {
  readonly distDir: string
  readonly outputDir: string
  readonly version: string
  readonly arch: DesktopPackageArch
  readonly iconPath: string
}

/**
 * Metadata describing a generated `.deb` package artifact.
 *
 * Returned by `buildLinuxDeb` after `dpkg-deb --build` succeeds.
 */
export interface ILinuxDebPackageResult {
  readonly debPath: string
  readonly debVersion: string
  readonly debArch: 'amd64'
  readonly packageName: string
}

/**
 * Normalize semver pre-release tags to Debian `~` syntax.
 *
 * Converts tags such as `3.7.1-beta1` to `3.7.1~beta1` so pre-releases sort
 * lower than final releases in `dpkg` version comparisons.
 */
export function toDebianVersion(version: string): string {
  const trimmed = version.trim()
  if (trimmed.length === 0) {
    throw new Error('Package version cannot be empty')
  }

  return trimmed.replace(/^(\d+\.\d+\.\d+)-/, '$1~')
}

/**
 * Map Electron packager architectures to Debian architecture names.
 *
 * Only `x64` (`amd64`) is supported; throws clearly for unsupported
 * architectures.
 */
export function toDebianArch(arch: DesktopPackageArch): 'amd64' {
  if (arch !== 'x64') {
    throw new Error(
      `Unsupported Linux Debian package architecture: '${arch}' (only 'x64' is supported)`
    )
  }

  return 'amd64'
}

/**
 * Build the Debian package filename for the given version and arch.
 *
 * Combines `linuxDebPackageName`, the normalized Debian version, and the
 * Debian architecture name.
 */
export function getLinuxDebFileName(
  version: string,
  arch: DesktopPackageArch
): string {
  return `${linuxDebPackageName}_${toDebianVersion(version)}_${toDebianArch(
    arch
  )}.deb`
}

function getDesktopEntryContent(): string {
  return [
    '[Desktop Entry]',
    'Name=GitHub Desktop',
    'Comment=Simple collaboration from your desktop',
    'GenericName=Git Client',
    'Exec=/usr/lib/github-desktop/desktop %u',
    'Icon=github-desktop',
    'Type=Application',
    'StartupNotify=true',
    'Categories=Development;RevisionControl;',
    `MimeType=${linuxDebMimeTypes.join(';')};`,
    '',
  ].join('\n')
}

function getAppArmorProfileContent(): string {
  return [
    '# This profile allows everything and only exists to give the',
    '# application a name instead of having the label "unconfined"',
    '',
    'abi <abi/4.0>,',
    'include <tunables/global>',
    '',
    `profile ${linuxDebAppArmorProfileName} /usr/lib/github-desktop/desktop flags=(unconfined) {`,
    '  userns,',
    '',
    '  # Site-specific additions and overrides. See local/README for details.',
    `  include if exists <local/${linuxDebAppArmorProfileName}>`,
    '}',
    '',
  ].join('\n')
}

function getDesktopCacheRefreshLines(): ReadonlyArray<string> {
  return [
    '    if command -v update-desktop-database >/dev/null 2>&1; then',
    '      update-desktop-database -q /usr/share/applications || true',
    '    fi',
    '    if command -v gtk-update-icon-cache >/dev/null 2>&1; then',
    '      gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true',
    '    fi',
  ]
}

function getPreinstScript(): string {
  return [
    '#!/bin/sh',
    'set -e',
    '',
    'if [ "$1" = "upgrade" ] && [ -n "${2:-}" ] && dpkg --compare-versions "$2" lt "3.7.0"; then',
    '  if [ -n "${SUDO_USER:-}" ]; then',
    '    user_home=$(getent passwd "$SUDO_USER" | cut -d: -f6 || true)',
    '    config_dir="$user_home/.config/GitHub Desktop"',
    '    if [ -d "$config_dir/IndexedDB" ] && [ ! -e "$config_dir/IndexedDB.pre-3.7.bak" ]; then',
    '      cp -a "$config_dir/IndexedDB" "$config_dir/IndexedDB.pre-3.7.bak" || true',
    '    fi',
    '  fi',
    'fi',
    '',
    'exit 0',
    '',
  ].join('\n')
}

function getPostinstScript(): string {
  return [
    '#!/bin/sh',
    'set -e',
    '',
    'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    `APP_PROFILE="/etc/apparmor.d/${linuxDebAppArmorProfileName}"`,
    `LOCAL_PROFILE="/etc/apparmor.d/local/${linuxDebAppArmorProfileName}"`,
    'SANDBOX_BIN="/usr/lib/github-desktop/chrome-sandbox"',
    '',
    'case "$1" in',
    '  configure|abort-upgrade|abort-remove|abort-deconfigure)',
    '    apparmor_loaded=0',
    '    if [ -f /etc/apparmor.d/abi/4.0 ] && [ -f "$APP_PROFILE" ]; then',
    '      if [ ! -e "$LOCAL_PROFILE" ] && [ -d /etc/apparmor.d/local ]; then',
    '        install -m 644 /dev/null "$LOCAL_PROFILE" 2>/dev/null || true',
    '      fi',
    '      if command -v apparmor_parser >/dev/null 2>&1; then',
    '        if aa-enabled --quiet 2>/dev/null || [ -d /sys/kernel/security/apparmor ]; then',
    '          if apparmor_parser -r -T -W "$APP_PROFILE" 2>/dev/null; then',
    '            apparmor_loaded=1',
    '          fi',
    '        fi',
    '      fi',
    '    fi',
    '',
    '    if [ "$apparmor_loaded" -eq 0 ] && [ -f "$SANDBOX_BIN" ]; then',
    '      chown root:root "$SANDBOX_BIN" || true',
    '      chmod 4755 "$SANDBOX_BIN" || true',
    '    fi',
    '',
    '    ln -sfn /usr/lib/github-desktop/resources/app/static/github.sh /usr/bin/github-desktop',
    '',
    ...getDesktopCacheRefreshLines(),
    '    ;;',
    'esac',
    '',
    'exit 0',
    '',
  ].join('\n')
}

function getPostrmScript(): string {
  return [
    '#!/bin/sh',
    'set -e',
    '',
    'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    `APP_PROFILE="/etc/apparmor.d/${linuxDebAppArmorProfileName}"`,
    `LOCAL_PROFILE="/etc/apparmor.d/local/${linuxDebAppArmorProfileName}"`,
    '',
    'case "$1" in',
    '  remove|purge)',
    '    if command -v apparmor_parser >/dev/null 2>&1; then',
    '      if [ -f "$APP_PROFILE" ]; then',
    '        apparmor_parser -R "$APP_PROFILE" 2>/dev/null || true',
    '      else',
    `        printf 'profile ${linuxDebAppArmorProfileName} {}\\n' | apparmor_parser -R 2>/dev/null || true`,
    '      fi',
    '    fi',
    '',
    '    if [ "$1" = "purge" ]; then',
    '      rm -f "$LOCAL_PROFILE"',
    '    fi',
    '',
    ...getDesktopCacheRefreshLines(),
    '    ;;',
    'esac',
    '',
    'exit 0',
    '',
  ].join('\n')
}

function getControlFileContent(
  debVersion: string,
  debArch: 'amd64',
  installedSizeKiB: number
): string {
  return [
    `Package: ${linuxDebPackageName}`,
    `Version: ${debVersion}`,
    `Architecture: ${debArch}`,
    `Maintainer: ${linuxDebMaintainer}`,
    `Homepage: ${linuxDebHomepage}`,
    'Section: devel',
    'Priority: optional',
    `Installed-Size: ${installedSizeKiB}`,
    `Depends: ${linuxDebDepends.join(', ')}`,
    'Description: Simple collaboration from your desktop',
    ' GitHub Desktop is an open-source application for collaborating',
    ' with Git and GitHub from your desktop.',
    '',
  ].join('\n')
}

function computeDirectorySizeBytes(dirPath: string): number {
  let total = 0
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      total += computeDirectorySizeBytes(entryPath)
      continue
    }
    const stat = lstatSync(entryPath)
    if (stat.isFile()) {
      total += stat.size
    }
  }
  return total
}

function makeDirsWithMode(root: string, relativePaths: ReadonlyArray<string>) {
  for (const relPath of relativePaths) {
    const fullPath = join(root, relPath)
    mkdirSync(fullPath, { recursive: true })
    chmodSync(fullPath, 0o755)
  }
}

/**
 * Package a built Linux distribution directory into a native `.deb`.
 *
 * Stages FHS paths, `/usr/bin/github-desktop` CLI wrapper symlink, `.desktop`
 * URI schemes, AppArmor profile, and maintainer scripts, then builds the
 * package using `fakeroot` and `dpkg-deb`.
 */
export function buildLinuxDeb(
  options: ILinuxDebPackageOptions
): ILinuxDebPackageResult {
  const desktopBinary = join(options.distDir, 'desktop')
  if (!existsSync(options.distDir)) {
    throw new Error(`Distribution directory not found: ${options.distDir}`)
  }
  if (!existsSync(desktopBinary)) {
    throw new Error(`Expected Linux desktop binary at: ${desktopBinary}`)
  }
  if (!existsSync(options.iconPath)) {
    throw new Error(`Expected Linux icon PNG at: ${options.iconPath}`)
  }

  const debVersion = toDebianVersion(options.version)
  const debArch = toDebianArch(options.arch)
  const debPath = join(
    options.outputDir,
    getLinuxDebFileName(options.version, options.arch)
  )

  const stagingRoot = mkdtempSync(join(tmpdir(), 'github-desktop-deb-'))
  const stagingDir = join(stagingRoot, 'pkg')

  try {
    mkdirSync(stagingDir, { recursive: true })
    chmodSync(stagingDir, 0o755)

    makeDirsWithMode(stagingDir, [
      'DEBIAN',
      'etc',
      'etc/apparmor.d',
      'usr',
      'usr/bin',
      'usr/lib',
      'usr/share',
      'usr/share/applications',
      'usr/share/icons',
      'usr/share/icons/hicolor',
      'usr/share/icons/hicolor/512x512',
      'usr/share/icons/hicolor/512x512/apps',
    ])

    const appInstallDir = join(stagingDir, 'usr', 'lib', 'github-desktop')
    cpSync(options.distDir, appInstallDir, {
      recursive: true,
      verbatimSymlinks: true,
    })
    chmodSync(appInstallDir, 0o755)
    chmodSync(join(appInstallDir, 'desktop'), 0o755)

    const sandboxPath = join(appInstallDir, 'chrome-sandbox')
    if (existsSync(sandboxPath)) {
      chmodSync(sandboxPath, 0o755)
    }

    const cliWrapperDest = join(
      appInstallDir,
      'resources',
      'app',
      'static',
      'github.sh'
    )
    if (!existsSync(cliWrapperDest)) {
      const repoCliWrapper = join(
        __dirname,
        '..',
        'app',
        'static',
        'linux',
        'github.sh'
      )
      if (!existsSync(repoCliWrapper)) {
        throw new Error(`Expected Linux CLI wrapper at: ${repoCliWrapper}`)
      }
      mkdirSync(dirname(cliWrapperDest), { recursive: true })
      cpSync(repoCliWrapper, cliWrapperDest)
    }
    chmodSync(cliWrapperDest, 0o755)

    symlinkSync(
      '/usr/lib/github-desktop/resources/app/static/github.sh',
      join(stagingDir, 'usr', 'bin', 'github-desktop')
    )

    const iconDest = join(
      stagingDir,
      'usr',
      'share',
      'icons',
      'hicolor',
      '512x512',
      'apps',
      'github-desktop.png'
    )
    cpSync(options.iconPath, iconDest)
    chmodSync(iconDest, 0o644)

    const desktopDest = join(
      stagingDir,
      'usr',
      'share',
      'applications',
      'github-desktop.desktop'
    )
    writeFileSync(desktopDest, getDesktopEntryContent(), 'utf8')
    chmodSync(desktopDest, 0o644)

    const apparmorDest = join(
      stagingDir,
      'etc',
      'apparmor.d',
      linuxDebAppArmorProfileName
    )
    writeFileSync(apparmorDest, getAppArmorProfileContent(), 'utf8')
    chmodSync(apparmorDest, 0o644)

    const payloadBytes =
      computeDirectorySizeBytes(join(stagingDir, 'usr')) +
      computeDirectorySizeBytes(join(stagingDir, 'etc'))
    const installedSizeKiB = Math.max(1, Math.ceil(payloadBytes / 1024))

    const controlDest = join(stagingDir, 'DEBIAN', 'control')
    writeFileSync(
      controlDest,
      getControlFileContent(debVersion, debArch, installedSizeKiB),
      'utf8'
    )
    chmodSync(controlDest, 0o644)

    const conffilesDest = join(stagingDir, 'DEBIAN', 'conffiles')
    writeFileSync(
      conffilesDest,
      `/etc/apparmor.d/${linuxDebAppArmorProfileName}\n`,
      'utf8'
    )
    chmodSync(conffilesDest, 0o644)

    const preinstDest = join(stagingDir, 'DEBIAN', 'preinst')
    writeFileSync(preinstDest, getPreinstScript(), 'utf8')
    chmodSync(preinstDest, 0o755)

    const postinstDest = join(stagingDir, 'DEBIAN', 'postinst')
    writeFileSync(postinstDest, getPostinstScript(), 'utf8')
    chmodSync(postinstDest, 0o755)

    const postrmDest = join(stagingDir, 'DEBIAN', 'postrm')
    writeFileSync(postrmDest, getPostrmScript(), 'utf8')
    chmodSync(postrmDest, 0o755)

    mkdirSync(options.outputDir, { recursive: true })
    rmSync(debPath, { force: true })

    execFileSync('fakeroot', ['dpkg-deb', '--build', stagingDir, debPath], {
      encoding: 'utf8',
      stdio: 'pipe',
    })

    return {
      debPath,
      debVersion,
      debArch,
      packageName: linuxDebPackageName,
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}
