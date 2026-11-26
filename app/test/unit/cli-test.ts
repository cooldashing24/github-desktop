import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { join } from 'path'
import {
  ICLIChildProcess,
  ICLIDependencies,
  runCLI,
} from '../../src/cli/run-cli'

class MockExitError extends Error {
  public readonly code: number

  public constructor(code: number) {
    super(`Process exited with code ${code}`)
    this.code = code
  }
}

class MockChildProcess extends EventEmitter implements ICLIChildProcess {
  public unrefCalled = false

  public unref(): void {
    this.unrefCalled = true
  }
}

interface ISpawnCall {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly options: { readonly detached: boolean; readonly stdio: 'ignore' }
  readonly child: MockChildProcess
}

interface IExecFileCall {
  readonly file: string
  readonly args: ReadonlyArray<string>
  readonly callback: (error: unknown | null, stderr?: string) => void
}

function createHarness(overrides: Partial<ICLIDependencies> = {}) {
  const spawnCalls: Array<ISpawnCall> = []
  const execFileCalls: Array<IExecFileCall> = []
  const stderrChunks: Array<string> = []
  const errorLogs: Array<ReadonlyArray<unknown>> = []
  const exitCodes: Array<number | null> = []
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }

  const deps: ICLIDependencies = {
    platform: 'linux',
    cliDir: '/usr/lib/github-desktop/resources/app',
    cwd: '/home/tester/workspace',
    isDev: false,
    env,
    spawn: (command, args, options) => {
      const child = new MockChildProcess()
      spawnCalls.push({ command, args, options, child })
      return child
    },
    execFile: (file, args, callback) => {
      execFileCalls.push({ file, args, callback })
    },
    stderr: {
      write: (chunk: string) => {
        stderrChunks.push(chunk)
        return true
      },
    },
    exit: code => {
      throw new MockExitError(code)
    },
    setExitCode: code => {
      exitCodes.push(code)
    },
    logError: (...data) => {
      errorLogs.push(data)
    },
    ...overrides,
  }

  return {
    deps,
    env,
    spawnCalls,
    execFileCalls,
    stderrChunks,
    errorLogs,
    exitCodes,
  }
}

describe('CLI entrypoint', () => {
  describe('linux', () => {
    it('spawns the Linux desktop binary detached with current working directory when given no args', () => {
      const { deps, env, spawnCalls } = createHarness()

      runCLI([], deps)

      assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined)
      assert.strictEqual(spawnCalls.length, 1)
      assert.strictEqual(
        spawnCalls[0].command,
        join('/usr/lib/github-desktop/resources/app', '../../desktop')
      )
      assert.deepStrictEqual(spawnCalls[0].args, [
        '--cli-open=/home/tester/workspace',
      ])
      assert.deepStrictEqual(spawnCalls[0].options, {
        detached: true,
        stdio: 'ignore',
      })
      assert.strictEqual(spawnCalls[0].child.unrefCalled, true)
    })

    it('spawns with --cli-open for a relative or absolute directory path', () => {
      const relative = createHarness()
      runCLI(['my-repo'], relative.deps)
      assert.deepStrictEqual(relative.spawnCalls[0].args, [
        '--cli-open=/home/tester/workspace/my-repo',
      ])

      const absolute = createHarness()
      runCLI(['/opt/repos/desktop'], absolute.deps)
      assert.deepStrictEqual(absolute.spawnCalls[0].args, [
        '--cli-open=/opt/repos/desktop',
      ])
    })

    it('spawns with --cli-open for open [path]', () => {
      const noPath = createHarness()
      runCLI(['open'], noPath.deps)
      assert.deepStrictEqual(noPath.spawnCalls[0].args, [
        '--cli-open=/home/tester/workspace',
      ])

      const withPath = createHarness()
      runCLI(['open', '../other-repo'], withPath.deps)
      assert.deepStrictEqual(withPath.spawnCalls[0].args, [
        '--cli-open=/home/tester/other-repo',
      ])
    })

    it('spawns with --cli-clone and optional --cli-branch for clone commands', () => {
      const slug = createHarness()
      runCLI(['clone', 'torvalds/linux'], slug.deps)
      assert.deepStrictEqual(slug.spawnCalls[0].args, [
        '--cli-clone=https://github.com/torvalds/linux',
      ])

      const withBranch = createHarness()
      runCLI(
        ['clone', '-b', 'feat/ubuntu-support', 'https://example.com/repo.git'],
        withBranch.deps
      )
      assert.deepStrictEqual(withBranch.spawnCalls[0].args, [
        '--cli-clone=https://example.com/repo.git',
        '--cli-branch=feat/ubuntu-support',
      ])
    })

    it('prints usage and exits with code 1 when clone has no URL', () => {
      const { deps, spawnCalls, stderrChunks } = createHarness()

      assert.throws(
        () => runCLI(['clone'], deps),
        err => err instanceof MockExitError && err.code === 1
      )
      assert.strictEqual(spawnCalls.length, 0)
      assert.match(stderrChunks.join(''), /GitHub Desktop CLI usage/)
    })

    it('prints usage and exits with code 0 for --help, -h, and help', () => {
      for (const helpArgs of [['--help'], ['-h'], ['help']]) {
        const { deps, spawnCalls, stderrChunks } = createHarness()
        assert.throws(
          () => runCLI(helpArgs, deps),
          err => err instanceof MockExitError && err.code === 0
        )
        assert.strictEqual(spawnCalls.length, 0)
        assert.match(stderrChunks.join(''), /GitHub Desktop CLI usage/)
      }
    })

    it('propagates child exit code and handles spawn errors', () => {
      const { deps, spawnCalls, exitCodes, errorLogs } = createHarness()
      runCLI(['/opt/repos/desktop'], deps)

      const { child } = spawnCalls[0]
      child.emit('exit', 42)
      assert.deepStrictEqual(exitCodes, [42])

      const spawnErr = Object.assign(new Error('ENOENT'), { code: 127 })
      assert.throws(
        () => child.emit('error', spawnErr),
        err => err instanceof MockExitError && err.code === 127
      )
      assert.strictEqual(errorLogs.length, 2)
    })
  })

  describe('darwin and win32 regressions', () => {
    it('keeps macOS open invocation unchanged', () => {
      const { deps, execFileCalls, spawnCalls } = createHarness({
        platform: 'darwin',
        cliDir: '/Applications/GitHub Desktop.app/Contents/Resources/app',
      })

      runCLI(['open', '/Users/tester/repo'], deps)

      assert.strictEqual(spawnCalls.length, 0)
      assert.strictEqual(execFileCalls.length, 1)
      assert.strictEqual(execFileCalls[0].file, 'open')
      assert.deepStrictEqual(execFileCalls[0].args, [
        '-n',
        '/Applications/GitHub Desktop.app',
        '--args',
        '--cli-open=/Users/tester/repo',
      ])
    })

    it('keeps Windows detached spawn unchanged in production and dev', () => {
      const prod = createHarness({
        platform: 'win32',
        cliDir: '/app/resources/app',
        isDev: false,
      })
      runCLI(['clone', 'desktop/desktop'], prod.deps)
      assert.strictEqual(
        prod.spawnCalls[0].command,
        join('/app/resources/app', '../../GitHubDesktop.exe')
      )
      assert.deepStrictEqual(prod.spawnCalls[0].args, [
        '--cli-clone=https://github.com/desktop/desktop',
      ])
      assert.strictEqual(prod.spawnCalls[0].child.unrefCalled, true)

      const dev = createHarness({
        platform: 'win32',
        cliDir: '/app/resources/app',
        isDev: true,
      })
      runCLI([], dev.deps)
      assert.strictEqual(
        dev.spawnCalls[0].command,
        join('/app/resources/app', '../../GitHubDesktop-dev.exe')
      )
    })

    it('throws Unsupported platform on unknown platforms', () => {
      const { deps } = createHarness({ platform: 'freebsd' })

      assert.throws(() => runCLI([], deps), /Unsupported platform/)
    })
  })
})
