import assert from 'node:assert/strict'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, it } from 'node:test'
import { createTempDirectory } from '../app/test/helpers/temp'
import { getLaunchArgs } from './run'

describe('getLaunchArgs', () => {
  it('passes --no-sandbox on linux when apparmor_restrict_unprivileged_userns is 1', async t => {
    const dir = await createTempDirectory(t)
    const sysctlPath = join(dir, 'apparmor_restrict_unprivileged_userns')
    await writeFile(sysctlPath, '1\n')

    assert.deepEqual(getLaunchArgs('linux', sysctlPath), ['--no-sandbox'])
  })

  it('omits --no-sandbox on linux when apparmor_restrict_unprivileged_userns is 0', async t => {
    const dir = await createTempDirectory(t)
    const sysctlPath = join(dir, 'apparmor_restrict_unprivileged_userns')
    await writeFile(sysctlPath, '0\n')

    assert.deepEqual(getLaunchArgs('linux', sysctlPath), [])
  })

  it('omits --no-sandbox on linux when the sysctl file does not exist', async t => {
    const dir = await createTempDirectory(t)
    const sysctlPath = join(dir, 'missing-sysctl')

    assert.deepEqual(getLaunchArgs('linux', sysctlPath), [])
  })

  for (const platform of ['darwin', 'win32'] as const) {
    it(`omits --no-sandbox on ${platform} even if the sysctl file contains 1`, async t => {
      const dir = await createTempDirectory(t)
      const sysctlPath = join(dir, 'apparmor_restrict_unprivileged_userns')
      await writeFile(sysctlPath, '1\n')

      assert.deepEqual(getLaunchArgs(platform, sysctlPath), [])
    })
  }
})
