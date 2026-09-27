/** Locale namespace owning the SSH directory browser's copy. */
export const LOCALE_NS = 'ssh-directory-browser'

/** Dictionaries for the reusable directory browser as presented for LAN SSH. */
export const DICTIONARIES: readonly [locale: string, dict: Record<string, string>][] = [
  ['zh', {
    'browser.title': '选择 SSH 工作区目录',
    'browser.home': '主目录',
    'browser.newFolder': '新建文件夹',
    'browser.folderName': '文件夹名称',
    'browser.createIn': '在"{name}"中新建文件夹',
    'browser.untitledFolder': '未命名文件夹',
    'browser.create': '创建',
    'browser.cancel': '取消',
    'browser.open': '打开',
    'browser.editPath': '编辑路径',
    'browser.loading': '加载中...',
    'browser.truncated': '文件夹过多，仅显示开头部分。',
    'browser.showHidden': '显示隐藏文件',
    'browser.noHost': '没有可用的 SSH 主机。',
  }],
  ['en', {
    'browser.title': 'Select SSH Workspace Directory',
    'browser.home': 'Home',
    'browser.newFolder': 'New folder',
    'browser.folderName': 'Folder name',
    'browser.createIn': 'New folder in "{name}"',
    'browser.untitledFolder': 'Untitled folder',
    'browser.create': 'Create',
    'browser.cancel': 'Cancel',
    'browser.open': 'Open',
    'browser.editPath': 'Edit path',
    'browser.loading': 'Loading...',
    'browser.truncated': 'Too many folders to list; only the beginning is shown.',
    'browser.showHidden': 'Show hidden files',
    'browser.noHost': 'No SSH host is available.',
  }],
]
