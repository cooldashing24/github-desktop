import assert from 'node:assert/strict'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, it } from 'node:test'
import { createTempDirectory } from '../app/test/helpers/temp'
import { getPackagerOptions } from './packager-options'

describe('getPackagerOptions', () => {
  it('omits Assets.car and macOS/Windows options on linux and uses the Linux PNG icon', async t => {
    const iconDirectory = await createTempDirectory(t)
    const linuxIconPath = '/repo/app/static/linux/icon-logo.png'

    const options = getPackagerOptions({
      platform: 'linux',
      arch: 'x64',
      executableName: 'desktop',
      distRoot: '/repo/dist',
      outRoot: '/repo/out',
      iconDirectory,
      linuxIconPath,
      bundleId: 'com.github.GitHubClient',
      companyName: 'GitHub, Inc.',
      productName: 'GitHub Desktop',
      isDevelopmentBuild: false,
      isPublishableBuild: true,
      entitlementsPath: '/repo/script/entitlements.plist',
      extendInfoPath: '/repo/script/info.plist',
      osxNotarize: {
        appleApiKey: 'key',
        appleApiKeyId: 'key-id',
        appleApiIssuer: 'issuer',
      },
    })

    assert.equal(options.platform, 'linux')
    assert.equal(options.arch, 'x64')
    assert.equal(options.icon, linuxIconPath)
    assert.equal('extraResource' in options, false)
    assert.equal('appBundleId' in options, false)
    assert.equal('appCategoryType' in options, false)
    assert.equal('darwinDarkModeSupport' in options, false)
    assert.equal('osxSign' in options, false)
    assert.equal('osxNotarize' in options, false)
    assert.equal('protocols' in options, false)
    assert.equal('extendInfo' in options, false)
    assert.equal('win32metadata' in options, false)
  })

  it('includes win32metadata and omits Assets.car and macOS options on win32', async t => {
    const iconDirectory = await createTempDirectory(t)

    const options = getPackagerOptions({
      platform: 'win32',
      arch: 'x64',
      executableName: 'GitHubDesktop',
      distRoot: '/repo/dist',
      outRoot: '/repo/out',
      iconDirectory,
      linuxIconPath: '/repo/app/static/linux/icon-logo.png',
      bundleId: 'com.github.GitHubClient',
      companyName: 'GitHub, Inc.',
      productName: 'GitHub Desktop',
      isDevelopmentBuild: false,
      isPublishableBuild: true,
      entitlementsPath: '/repo/script/entitlements.plist',
      extendInfoPath: '/repo/script/info.plist',
    })

    assert.equal(options.platform, 'win32')
    assert.equal(options.icon, join(iconDirectory, 'icon-logo'))
    assert.equal('extraResource' in options, false)
    assert.equal('osxSign' in options, false)
    assert.deepEqual(options.win32metadata, {
      CompanyName: 'GitHub, Inc.',
      FileDescription: '',
      OriginalFilename: '',
      ProductName: 'GitHub Desktop',
      InternalName: 'GitHub Desktop',
    })
  })

  it('requires Assets.car and bundles macOS packager options on darwin', async t => {
    const iconDirectory = await createTempDirectory(t)
    const context = {
      platform: 'darwin' as const,
      arch: 'arm64',
      executableName: 'GitHub Desktop',
      distRoot: '/repo/dist',
      outRoot: '/repo/out',
      iconDirectory,
      linuxIconPath: '/repo/app/static/linux/icon-logo.png',
      bundleId: 'com.github.GitHubClient',
      companyName: 'GitHub, Inc.',
      productName: 'GitHub Desktop',
      isDevelopmentBuild: false,
      isPublishableBuild: true,
      entitlementsPath: '/repo/script/entitlements.plist',
      extendInfoPath: '/repo/script/info.plist',
      osxNotarize: {
        appleApiKey: 'key',
        appleApiKeyId: 'key-id',
        appleApiIssuer: 'issuer',
      },
    }

    assert.throws(
      () => getPackagerOptions(context),
      /Unable to find Assets\.car/
    )

    const assetsCarPath = join(iconDirectory, 'Assets.car')
    await writeFile(assetsCarPath, 'car')

    const options = getPackagerOptions(context)
    assert.equal(options.platform, 'darwin')
    assert.equal(options.icon, join(iconDirectory, 'icon-logo-legacy.icns'))
    assert.deepEqual(options.extraResource, [assetsCarPath])
    assert.equal(options.appBundleId, 'com.github.GitHubClient')
    assert.equal(options.appCategoryType, 'public.app-category.developer-tools')
    assert.equal(options.darwinDarkModeSupport, true)
    assert.equal(options.extendInfo, '/repo/script/info.plist')
    assert.deepEqual(options.osxNotarize, context.osxNotarize)
    assert.deepEqual(options.protocols, [
      {
        name: 'com.github.GitHubClient',
        schemes: ['x-github-desktop-auth', 'x-github-client', 'github-mac'],
      },
    ])
    assert.equal(typeof options.osxSign, 'object')
    assert.equal('win32metadata' in options, false)
  })
})
