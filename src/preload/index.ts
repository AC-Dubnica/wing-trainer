import { contextBridge, ipcRenderer } from 'electron'

export interface AudioFile { name: string; path: string; bytes: number }
export interface SnapshotFile { name: string; path: string; text: string }

const api = {
  /** The snapshot that was open last time (read again from its file) and where the work ended. */
  loadSession: (): Promise<{ snapshot: SnapshotFile | null; state: unknown }> => ipcRenderer.invoke('session:load'),
  saveSession: (state: unknown): Promise<void> => ipcRenderer.invoke('session:save', state),
  forgetSnapshot: (): Promise<void> => ipcRenderer.invoke('session:sample'),
  openSnapshot: (): Promise<SnapshotFile | null> => ipcRenderer.invoke('snapshot:open'),
  /** Saves the edited snapshot under a new name; null when cancelled. */
  saveSnapshot: (req: { text: string; suggestedName: string; notes: string }): Promise<{ path: string; notes: string } | { error: string } | null> => ipcRenderer.invoke('snapshot:save', req),
  /** Asks for a folder, or with `again` opens that folder without asking. */
  openRecordingFolder: (again?: string): Promise<{ dir: string; files: AudioFile[] } | null> => ipcRenderer.invoke('audio:folder', again),
  openAudioFile: (): Promise<AudioFile | null> => ipcRenderer.invoke('audio:file'),
  /** Tests only (the handler exists when a test script runs the app): a real click with modifier keys. */
  /** Tests only: a real key press with modifier keys. */
  testKey: (keyCode: string, modifiers: string[]): Promise<void> => ipcRenderer.invoke('test:key', keyCode, modifiers),
  testClick: (x: number, y: number, modifiers: string[]): Promise<void> => ipcRenderer.invoke('test:click', x, y, modifiers),
  readAudio: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('audio:read', path),
}

contextBridge.exposeInMainWorld('trainer', api)
export type TrainerApi = typeof api
