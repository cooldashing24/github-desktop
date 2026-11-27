import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import { getConfirmRevealDirectoryOptions } from '../../src/main-process/reveal-directory-dialog'

function setPlatformGlobals(
  t: TestContext,
  overrides: {
    readonly darwin?: boolean
    readonly win32?: boolean
    readonly linux?: boolean
  }
) {
  const previous = {
    __DARWIN__,
    __WIN32__,
    __LINUX__,
  }

  Object.assign(globalThis, {
    __DARWIN__: overrides.darwin ?? false,
    __WIN32__: overrides.win32 ?? false,
    __LINUX__: overrides.linux ?? false,
  })

  t.after(() => Object.assign(globalThis, previous))
}

describe('getConfirmRevealDirectoryOptions', () => {
  it('uses File Manager wording on Linux', async t => {
    setPlatformGlobals(t, { linux: true })

    assert.deepStrictEqual(getConfirmRevealDirectoryOptions(), {
      type: 'warning',
      title: 'Reveal Repository in File Manager?',
      message: 'This repository might be an application.',
      detail:
        'Opening it directly could run software. You can reveal and select it in File Manager without opening it.',
      buttons: ['Reveal in File Manager', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
  })

  it('preserves Finder wording on macOS', async t => {
    setPlatformGlobals(t, { darwin: true })

    assert.deepStrictEqual(getConfirmRevealDirectoryOptions(), {
      type: 'warning',
      title: 'Reveal Repository in Finder?',
      message: 'This repository might be an application.',
      detail:
        'Opening it directly could run software. You can reveal and select it in Finder without opening it.',
      buttons: ['Reveal in Finder', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
  })

  it('uses Explorer wording on Windows', async t => {
    setPlatformGlobals(t, { win32: true })

    assert.deepStrictEqual(getConfirmRevealDirectoryOptions(), {
      type: 'warning',
      title: 'Reveal Repository in Explorer?',
      message: 'This repository might be an application.',
      detail:
        'Opening it directly could run software. You can reveal and select it in Explorer without opening it.',
      buttons: ['Reveal in Explorer', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
  })
})
