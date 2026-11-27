import { join, resolve } from 'path'
import parse from 'minimist'
import { execFile, spawn } from 'child_process'

/**
 * Minimal child process handle returned by `spawn`.
 *
 * Exposes the lifecycle event hooks and `unref()` needed to detach the
 * launched Desktop application from the CLI process.
 */
export interface ICLIChildProcess {
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'exit', listener: (code: number | null) => void): this
  unref(): void
}

/**
 * External process and environment dependencies for `runCLI`.
 *
 * Provides test seams for platform, working directory, environment variables,
 * child process launching, stderr output, and exit termination.
 */
export interface ICLIDependencies {
  readonly platform?: NodeJS.Platform
  readonly cliDir?: string
  readonly cwd?: string
  readonly isDev?: boolean
  readonly env?: NodeJS.ProcessEnv
  readonly execFile?: (
    file: string,
    args: ReadonlyArray<string>,
    callback: (error: unknown | null, stderr?: string) => void
  ) => unknown
  readonly spawn?: (
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly detached: boolean; readonly stdio: 'ignore' }
  ) => ICLIChildProcess
  readonly stderr?: Pick<NodeJS.WriteStream, 'write'>
  readonly exit?: (code: number) => never
}

/**
 * Parse GitHub Desktop CLI arguments and launch the Desktop application.
 *
 * Supports `open`, `clone`, `--help`/`help`, and bare path arguments across
 * macOS, Windows, and Linux.
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

  const launch = (...launchArgs: Array<string>) => {
    function handleLaunchError(error: unknown | null, stderrText?: string) {
      if (error) {
        stderr.write(`Error running command ${launchArgs}\n`)
        stderr.write(`${stderrText ?? error}\n`)
        exit(
          typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'number'
            ? error.code
            : 1
        )
      }
    }

    const spawnDetached = (executablePath: string) => {
      spawnFn(executablePath, launchArgs, {
        detached: true,
        stdio: 'ignore',
      })
        .on('error', handleLaunchError)
        .on('exit', code => (process.exitCode = code ?? process.exitCode))
        .unref()
    }

    if (platform === 'darwin') {
      execFileFn(
        'open',
        ['-n', join(cliDir, '../../..'), '--args', ...launchArgs],
        handleLaunchError
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
