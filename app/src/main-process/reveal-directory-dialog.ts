function getFileManagerName(): string {
  if (__DARWIN__) {
    return 'Finder'
  }
  if (__WIN32__) {
    return 'Explorer'
  }
  return 'File Manager'
}

/**
 * Returns the platform-appropriate confirmation dialog options shown before
 * revealing a repository directory that may be an executable bundle.
 */
export function getConfirmRevealDirectoryOptions(): Electron.MessageBoxOptions {
  const fileManagerName = getFileManagerName()

  return {
    type: 'warning',
    title: `Reveal Repository in ${fileManagerName}?`,
    message: 'This repository might be an application.',
    detail: `Opening it directly could run software. You can reveal and select it in ${fileManagerName} without opening it.`,
    buttons: [`Reveal in ${fileManagerName}`, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
}
