/* eslint-disable no-sync */

import assert from 'assert'
import { existsSync } from 'fs'
import * as os from 'os'
import { join } from 'path'

/**
 * Target CPU architecture supported by `@electron/packager`.
 *
 * GitHub Desktop builds target `x64` and `arm64`.
 */
export type DesktopPackageArch = 'arm64' | 'x64'

/**
 * Target operating system platform supported by `@electron/packager`.
 *
 * GitHub Desktop builds target `darwin`, `linux`, and `win32`.
 */
export type DesktopPackagePlatform = 'darwin' | 'linux' | 'win32'

/**
 * macOS notarization credentials passed to `@electron/packager`.
 *
 * Used for publishable macOS builds in CI.
 */
export interface IOSXNotarizeOptions {
  readonly appleApiKey: string
  readonly appleApiKeyId: string
  readonly appleApiIssuer: string
}

/**
 * Inputs required to construct `@electron/packager` options.
 *
 * Centralizes platform-specific paths, build flags, and metadata.
 */
export interface IPackagerOptionsContext {
  readonly platform: NodeJS.Platform
  readonly arch: string | undefined
  readonly executableName: string
  readonly distRoot: string
  readonly outRoot: string
  readonly iconDirectory: string
  readonly linuxIconPath: string
  readonly bundleId: string
  readonly companyName: string
  readonly productName: string
  readonly isDevelopmentBuild: boolean
  readonly isPublishableBuild: boolean
  readonly entitlementsPath: string
  readonly extendInfoPath: string
  readonly osxNotarize?: IOSXNotarizeOptions
}

/**
 * Validate and narrow a Node platform to a supported packager platform.
 *
 * Throws an error if the platform is not `win32`, `darwin`, or `linux`.
 */
export function toPackagePlatform(
  platform: NodeJS.Platform
): DesktopPackagePlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform
  }
  throw new Error(
    `Unable to convert to platform for electron-packager: '${platform}'`
  )
}

/**
 * Resolve and validate the target CPU architecture for packaging.
 *
 * Defaults to `os.arch()` when `targetArch` is omitted.
 */
export function toPackageArch(
  targetArch: string | undefined
): DesktopPackageArch {
  const arch = targetArch === undefined ? os.arch() : targetArch

  if (arch === 'arm64' || arch === 'x64') {
    return arch
  }

  throw new Error(
    `Building Desktop for architecture '${arch}' is not supported`
  )
}

function getIconPath(context: IPackagerOptionsContext): string {
  if (context.platform === 'darwin') {
    // Packager probes for a sibling .icon file and requires macOS 26 to compile
    // it. Use a distinct basename so older build hosts use the prebuilt ICNS.
    return join(context.iconDirectory, 'icon-logo-legacy.icns')
  }

  if (context.platform === 'linux') {
    return context.linuxIconPath
  }

  return join(context.iconDirectory, 'icon-logo')
}

/**
 * Build `@electron/packager` options for the target platform.
 *
 * Avoids asserting or bundling platform-specific assets (such as macOS
 * `Assets.car`) when packaging for other platforms.
 */
export function getPackagerOptions(
  context: IPackagerOptionsContext
): Record<string, unknown> {
  const platform = toPackagePlatform(context.platform)
  const arch = toPackageArch(context.arch)

  const baseOptions: Record<string, unknown> = {
    name: context.executableName,
    platform,
    arch,
    asar: false, // TODO: Probably wanna enable this down the road.
    out: context.distRoot,
    icon: getIconPath(context),
    dir: context.outRoot,
    overwrite: true,
    tmpdir: false,
    derefSymlinks: true,
    prune: false, // We'll prune them ourselves below.
    ignore: [
      new RegExp('/node_modules/electron($|/)'),
      new RegExp('/node_modules/@electron/packager($|/)'),
      new RegExp('/\\.git($|/)'),
      new RegExp('/node_modules/\\.bin($|/)'),
    ],
    appCopyright: `Copyright © ${new Date().getFullYear()} GitHub, Inc.`,
  }

  if (platform === 'darwin') {
    const assetsCarPath = join(context.iconDirectory, 'Assets.car')
    assert(
      existsSync(assetsCarPath),
      `Unable to find Assets.car at ${assetsCarPath}`
    )

    return {
      ...baseOptions,
      extraResource: [assetsCarPath],
      appBundleId: context.bundleId,
      appCategoryType: 'public.app-category.developer-tools',
      darwinDarkModeSupport: true,
      osxSign: {
        optionsForFile: (filePath: string) => ({
          hardenedRuntime: true,
          entitlements: context.entitlementsPath,
        }),
        type: context.isPublishableBuild ? 'distribution' : 'development',
        // For development, we will use '-' as the identifier so that codesign
        // will sign the app to run locally. We need to disable 'identity-validation'
        // or otherwise it will replace '-' with one of the regular codesigning
        // identities in our system.
        identity: context.isDevelopmentBuild ? '-' : undefined,
        identityValidation: !context.isDevelopmentBuild,
      },
      osxNotarize: context.osxNotarize,
      protocols: [
        {
          name: context.bundleId,
          schemes: [
            !context.isDevelopmentBuild
              ? 'x-github-desktop-auth'
              : 'x-github-desktop-dev-auth',
            'x-github-client',
            'github-mac',
          ],
        },
      ],
      extendInfo: context.extendInfoPath,
    }
  }

  if (platform === 'win32') {
    return {
      ...baseOptions,
      win32metadata: {
        CompanyName: context.companyName,
        FileDescription: '',
        OriginalFilename: '',
        ProductName: context.productName,
        InternalName: context.productName,
      },
    }
  }

  return baseOptions
}
