import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import * as React from 'react'
import { render, screen } from '../../helpers/ui/render'
import { About } from '../../../src/ui/about/about'
import { IUpdateState, UpdateStatus } from '../../../src/ui/lib/update-store'

function setPlatformGlobals(
  t: TestContext,
  overrides: {
    readonly darwin?: boolean
    readonly win32?: boolean
    readonly linux?: boolean
    readonly releaseChannel?: typeof __RELEASE_CHANNEL__
  }
) {
  const previous = {
    __DARWIN__,
    __WIN32__,
    __LINUX__,
    __RELEASE_CHANNEL__,
  }

  Object.assign(globalThis, {
    __DARWIN__: overrides.darwin ?? false,
    __WIN32__: overrides.win32 ?? false,
    __LINUX__: overrides.linux ?? false,
    __RELEASE_CHANNEL__: overrides.releaseChannel ?? 'production',
  })

  t.after(() => Object.assign(globalThis, previous))
}

async function stubIpcSend(t: TestContext) {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => {}
  t.after(() => {
    electron.ipcRenderer.send = previousSend
  })
}

function renderAbout(
  status: UpdateStatus = UpdateStatus.UpdateNotChecked,
  allowDevelopment?: boolean
) {
  const updateState: IUpdateState = {
    status,
    lastSuccessfulCheck: new Date('2026-01-01T00:00:00.000Z'),
    isX64ToARM64ImmediateAutoUpdate: false,
    newReleases: [],
    prioritizeUpdate: false,
    prioritizeUpdateInfoUrl: undefined,
  }

  return render(
    <About
      onDismissed={() => {}}
      applicationName="GitHub Desktop"
      applicationVersion="3.7.1"
      applicationArchitecture="x64"
      onCheckForNonStaggeredUpdates={() => {}}
      onShowAcknowledgements={() => {}}
      onShowTermsAndConditions={() => {}}
      onQuitAndInstall={() => {}}
      updateState={updateState}
      allowDevelopment={allowDevelopment}
    />
  )
}

describe('About', () => {
  it('omits the Check for Updates button and uses the Linux icon on Linux in production', async t => {
    setPlatformGlobals(t, { linux: true, releaseChannel: 'production' })
    await stubIpcSend(t)

    const view = renderAbout(UpdateStatus.UpdateNotAvailable)

    assert.strictEqual(
      screen.queryByRole('button', { name: 'Check for Updates', hidden: true }),
      null
    )

    const logo = view.container.querySelector('img[alt="GitHub Desktop"]')
    assert.notStrictEqual(logo, null)
    const src = logo?.getAttribute('src') ?? ''
    assert.ok(
      src.endsWith('/static/icon-logo.png'),
      `Expected Linux logo URL, got: ${src}`
    )
    assert.ok(!src.includes('windows-logo-64x64@2x.png'))
  })

  it('omits the Quit and Install Update button on Linux even if allowDevelopment is true', async t => {
    setPlatformGlobals(t, { linux: true, releaseChannel: 'development' })
    await stubIpcSend(t)

    renderAbout(UpdateStatus.UpdateReady, true)

    assert.strictEqual(
      screen.queryByRole('button', {
        name: 'Quit and Install Update',
        hidden: true,
      }),
      null
    )
  })

  it('shows the Check for Updates button and macOS icon on macOS in production', async t => {
    setPlatformGlobals(t, { darwin: true, releaseChannel: 'production' })
    await stubIpcSend(t)

    const view = renderAbout(UpdateStatus.UpdateNotChecked)

    assert.notStrictEqual(
      screen.queryByRole('button', { name: 'Check for Updates', hidden: true }),
      null
    )

    const logo = view.container.querySelector('img[alt="GitHub Desktop"]')
    assert.ok(logo?.getAttribute('src')?.endsWith('/static/logo-64x64@2x.png'))
  })

  it('shows the Check for Updates button and Windows icon on Windows in production', async t => {
    setPlatformGlobals(t, { win32: true, releaseChannel: 'production' })
    await stubIpcSend(t)

    const view = renderAbout(UpdateStatus.UpdateNotChecked)

    assert.notStrictEqual(
      screen.queryByRole('button', { name: 'Check for Updates', hidden: true }),
      null
    )

    const logo = view.container.querySelector('img[alt="GitHub Desktop"]')
    assert.ok(
      logo?.getAttribute('src')?.endsWith('/static/windows-logo-64x64@2x.png')
    )
  })

  it('omits the Check for Updates button in development builds on non-Linux without allowDevelopment', async t => {
    setPlatformGlobals(t, { darwin: true, releaseChannel: 'development' })
    await stubIpcSend(t)

    renderAbout(UpdateStatus.UpdateNotChecked)

    assert.strictEqual(
      screen.queryByRole('button', { name: 'Check for Updates', hidden: true }),
      null
    )
  })
})
