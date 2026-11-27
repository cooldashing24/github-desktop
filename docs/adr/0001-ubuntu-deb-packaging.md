# Ubuntu `.deb` Packaging and Runtime Strategy

Status: accepted

GitHub Desktop does not officially support Linux, and Ubuntu 24.04 enforces `kernel.apparmor_restrict_unprivileged_userns = 1`, renames shared libraries with the `t64` suffix, and drops `libgconf-2-4`. We will target Ubuntu 24.04+ (`x64`) on our fork (`cooldashing24/github-desktop`) by building native `.deb` packages directly via `dpkg-deb` + `fakeroot` in `script/package.ts`, rather than `AppImage` or `electron-installer-debian`, so we can ship an `/etc/apparmor.d/github-desktop-app` userns profile (avoiding collision with Ubuntu's built-in `/etc/apparmor.d/github-desktop` in the `apparmor` package, with `chrome-sandbox` fallback), `t64`-compatible `Depends:`, and a `.desktop` file registering all three OAuth/URI schemes (`x-github-client`, `x-github-desktop-auth`, and `x-github-desktop-dev-auth`). We keep X11/XWayland as the default display backend (opt-in Wayland via `ELECTRON_OZONE_PLATFORM_HINT=auto`) and keep Linux auto-updates and native `desktop-notifications` disabled for now.

## Considered Options

- **`.deb` via direct `dpkg-deb` + `fakeroot` (chosen)**: Zero new npm build dependencies, deterministic control/maintainer scripts, native AppArmor + `.desktop` integration, and clean Debian pre-release versioning (`~beta1`).
- **`electron-installer-debian`**: Adds an extra npm dependency and template constraints around custom Ubuntu 24.04 AppArmor rules.
- **`.AppImage`**: Portable single binary, but requires `appimagetool`/FUSE and hits Ubuntu 24.04 unprivileged user-namespace restrictions unless `--no-sandbox` or external AppArmor rules are added.

## Consequences

- Installed builds keep Electron's renderer sandbox enabled via `/etc/apparmor.d/github-desktop-app`, while unpackaged `npm start` dev runs may need `--no-sandbox` when user namespaces are restricted.
- Builds without custom `DESKTOP_OAUTH_CLIENT_ID`/`SECRET` fall back to dev OAuth (`x-github-desktop-dev-auth://`), which the `.desktop` entry handles alongside `x-github-desktop-auth://` and `x-github-client://`.
- System-wide installation uses `/usr/lib/github-desktop/`, `/usr/bin/github-desktop`, `/usr/share/applications/github-desktop.desktop`, and `/usr/share/icons/hicolor/512x512/apps/github-desktop.png` (without claiming `/usr/bin/github`).
