import { join, resolve } from 'path'
import parse from 'minimist'
import { execFile, spawn } from 'child_process'

export interface ICLIChildProcess {
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'exit', listener: (code: number | null) => void): this
  unref(): void
}

export type ExecFileFn = (
  file: string,
  args: ReadonlyArray<string>,
  callback: (error: unknown | null, stderr?: string) => void
) => unknown

export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly detached: boolean; readonly stdio: 'ignore' }
) => ICLIChildProcess

export interface ICLIDependencies {
  readonly platform?: NodeJS.Platform
  readonly cliDir?: string
  readonly cwd?: string
  readonly isDev?: boolean
  readonly env?: NodeJS.ProcessEnv
  readonly execFile?: ExecFileFn
  readonly spawn?: SpawnFn
  readonly stderr?: Pick<NodeJS.WriteStream, 'write'>
  readonly exit?: (code: number) => never
  readonly setExitCode?: (code: number | null) => void
  readonly logError?: (...data: ReadonlyArray<unknown>) => void
}

/**
 * Parse GitHub Desktop CLI arguments and launch the Desktop application for
 * the current platform.
 */
export function runCLI(
  argv: ReadonlyArray<string>,
  deps: ICLIDependencies = {}
): void {
  const platform = deps.platform ?? process.platform
  const cliDir = deps.cliDir ?? __dirname
  const cwd = deps.cwd ?? process.cwd()
  const isDev = deps.isDev ?? __DEV__
  const env = deps.env ?? process.env
  const execFileFn = deps.execFile ?? execFile
  const spawnFn = deps.spawn ?? spawn
  const stderr = deps.stderr ?? process.stderr
  const exit = deps.exit ?? (code => process.exit(code))
  const setExitCode =
    deps.setExitCode ??
    (code => {
      if (code !== null) {
        process.exitCode = code
      }
    })
  const logError = deps.logError ?? console.error

  const launch = (...launchArgs: Array<string>) => {
    function cb(e: unknown | null, stderrText?: string) {
      if (e) {
        logError(`Error running command ${launchArgs}`)
        logError(stderrText ?? `${e}`)
        exit(
          typeof e === 'object' && 'code' in e && typeof e.code === 'number'
            ? e.code
            : 1
        )
      }
    }

    const spawnDetached = (executablePath: string) => {
      spawnFn(executablePath, launchArgs, {
        detached: true,
        stdio: 'ignore',
      })
        .on('error', cb)
        .on('exit', code => setExitCode(code))
        .unref()
    }

    if (platform === 'darwin') {
      execFileFn(
        'open',
        ['-n', join(cliDir, '../../..'), '--args', ...launchArgs],
        cb
      )
    } else if (platform === 'win32') {
      const exeName = `GitHubDesktop${isDev ? '-dev' : ''}.exe`
      spawnDetached(join(cliDir, `../../${exeName}`))
    } else if (platform === 'linux') {
      spawnDetached(join(cliDir, '../../desktop'))
    } else {
      throw new Error('Unsupported platform')
    }
  }

  const args = parse([...argv], {
    alias: { help: 'h', branch: 'b' },
    boolean: ['help'],
  })

  const usage = (exitCode = 1): never => {
    stderr.write(
      'GitHub Desktop CLI usage: \n' +
        '  github                            Open the current directory\n' +
        '  github open [path]                Open the provided path\n' +
        '  github clone [-b branch] <url>    Clone the repository by url or name/owner\n' +
        '                                    (ex torvalds/linux), optionally checking out\n' +
        '                                    the branch\n'
    )
    return exit(exitCode)
  }

  delete env.ELECTRON_RUN_AS_NODE

  if (args.help || args._.at(0) === 'help') {
    usage(0)
  } else if (args._.at(0) === 'clone') {
    const urlArg = args._.at(1)
    // Assume name with owner slug if it looks like it
    const url =
      urlArg && /^[^\/]+\/[^\/]+$/.test(urlArg)
        ? `https://github.com/${urlArg}`
        : urlArg

    if (!url) {
      usage(1)
    } else if (typeof args.branch === 'string') {
      launch(`--cli-clone=${url}`, `--cli-branch=${args.branch}`)
    } else {
      launch(`--cli-clone=${url}`)
    }
  } else {
    const [firstArg, secondArg] = args._
    const pathArg = firstArg === 'open' ? secondArg : firstArg
    const path = resolve(cwd, pathArg ?? '.')
    launch(`--cli-open=${path}`)
  }
}
