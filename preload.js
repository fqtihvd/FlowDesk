const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSetup: (password) => ipcRenderer.invoke('auth:setup', password),
  authLogin: (password) => ipcRenderer.invoke('auth:login', password),
  authChangePassword: (current, next) =>
    ipcRenderer.invoke('auth:changePassword', { current, next }),

  getData: () => ipcRenderer.invoke('data:get'),

  createTheme: (name, type) => ipcRenderer.invoke('theme:create', { name, type }),
  updateTheme: (id, name) => ipcRenderer.invoke('theme:update', { id, name }),
  deleteTheme: (id) => ipcRenderer.invoke('theme:delete', { id }),
  reorderThemes: (orderedIds) => ipcRenderer.invoke('theme:reorder', { orderedIds }),

  createItem: (payload) => ipcRenderer.invoke('item:create', payload),
  updateItem: (id, patch) => ipcRenderer.invoke('item:update', { id, patch }),
  deleteItem: (id) => ipcRenderer.invoke('item:delete', { id }),
  reorderItems: (themeId, orderedIds) =>
    ipcRenderer.invoke('item:reorder', { themeId, orderedIds }),

  createNote: (payload) => ipcRenderer.invoke('notebook:create', payload),
  updateNote: (id, patch) => ipcRenderer.invoke('notebook:update', { id, patch }),
  deleteNote: (id) => ipcRenderer.invoke('notebook:delete', { id }),
  exportNote: (content, suggestedName, format) =>
    ipcRenderer.invoke('export:note', { content, suggestedName, format }),

  exportBackup: (options) => ipcRenderer.invoke('backup:export', options),
  pickBackup: () => ipcRenderer.invoke('backup:pick'),
  decryptBackup: (password) => ipcRenderer.invoke('backup:decrypt', { password }),
  applyBackup: (mode) => ipcRenderer.invoke('backup:apply', { mode }),
  cancelBackup: () => ipcRenderer.invoke('backup:cancel'),

  createCategory: (name, color) => ipcRenderer.invoke('category:create', { name, color }),
  updateCategory: (id, patch) => ipcRenderer.invoke('category:update', { id, patch }),
  deleteCategory: (id) => ipcRenderer.invoke('category:delete', { id }),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  getLicenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),

  exportCsv: (content, suggestedName) => ipcRenderer.invoke('export:csv', { content, suggestedName }),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('export:pdf', { html, suggestedName }),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Session lock: main asks the page to lock (window closed to tray); the
  // page saves pending edits, then confirms with lockSession().
  lockSession: () => ipcRenderer.invoke('session:lock'),
  onLock: (callback) => ipcRenderer.on('app:lock', () => callback()),

  // Fired when the user clicks a Windows reminder notification.
  onOpenNote: (callback) => ipcRenderer.on('note:open', (_e, itemId) => callback(itemId)),
});
