# Setting Up Development Dependencies on Linux

You will need to install these tools on your machine:

 - Node.js (includes npm)
 - Python 3
 - C/C++ build toolchain (`build-essential`)
 - Electron and native module dependencies
 - Debian packaging tools (`dpkg-deb` via `dpkg`, and `fakeroot`)

## Node.js

The NodeJS project has instructions for installing across a variety of
distributions and package managers.

Find your distribution on [this list](https://nodejs.org/en/download/package-manager/)
and follow the instructions to install the version you require.

Ensure that you also choose the option for building native Node modules, as
those are used in some dependencies used in GitHub Desktop.

## npm

Use the npm version bundled with the Node.js version in `.nvmrc` (npm 11.17.0+).
Run `node -v` and `npm -v` to verify both are available on your `PATH`.

Desktop uses `package-lock.json` files to pin dependencies across machines.
See [working with packages](./working-with-packages.md) for installation,
dependency updates, and script commands.

## Python 3

Refer to your distribution's package manager to obtain Python 3 (`python3`),
which is required by `node-gyp` when building native Node modules.

## Electron and packaging dependencies

There are additional system libraries and tools required for building,
running, and packaging GitHub Desktop on Linux:

 - `libsecret-1-dev` (`libsecret-1.so.0`) for reading and writing credentials using [`keytar`](https://github.com/atom/node-keytar)
 - `libxss1` (`libXss.so.1`) for the X11 screen saver extension
 - `libgbm1` for Chromium/Electron GPU buffer management
 - `libgtk-3-0t64` (`libgtk-3-0` on older releases) for GTK 3 windowing and dialogs
 - `libasound2t64` (`libasound2` on older releases) for ALSA audio support required by Electron
 - `build-essential` and `python3` for compiling native Node modules
 - `dpkg` (`dpkg-deb`) and `fakeroot` for building `.deb` packages

### Ubuntu 24.04 LTS

`libgconf-2-4` was removed in Ubuntu 24.04 and is no longer required. Install
the Ubuntu 24.04 dependencies with:

```shellsession
$ sudo apt update && sudo apt install -y \
  build-essential \
  python3 \
  libsecret-1-dev \
  libxss1 \
  libgbm1 \
  libgtk-3-0t64 \
  libasound2t64 \
  dpkg \
  fakeroot
```

### Fedora 26 and later

```shellsession
$ sudo dnf install -y libsecret-devel libXScrnSaver
```

## Building, running, and packaging

After cloning the repository, install dependencies and build from the repo root:

```shellsession
$ npm ci
$ npm run build:dev
$ npm start
```

> **Note on Ubuntu 24.04 AppArmor user-namespace restrictions:** Ubuntu 24.04
> sets `kernel.apparmor_restrict_unprivileged_userns = 1` by default. When
> launching an unpackaged local development build via `npm start`, the dev
> runner automatically detects this sysctl and passes `--no-sandbox` so
> Electron starts without sandbox crashes. Packaged `.deb` installations include
> an AppArmor profile and keep the renderer sandbox enabled.

To create a production build and package a `.deb` installer:

```shellsession
$ npm run build:prod
$ npm run package
```

## Back to setup

Once you've installed the necessary dependencies, head back to the [setup page](https://github.com/desktop/desktop/blob/development/docs/contributing/setup.md) to finish getting set up.
