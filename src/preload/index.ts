import { contextBridge, ipcRenderer } from 'electron'

export interface AudioFile { name: string; path: string; bytes: number }

const api = {
  openSnapshot: (): Promise<{ name: string; text: string } | null> => ipcRenderer.invoke('snapshot:open'),
  openRecordingFolder: (): Promise<{ dir: string; files: AudioFile[] } | null> => ipcRenderer.invoke('audio:folder'),
  openAudioFile: (): Promise<AudioFile | null> => ipcRenderer.invoke('audio:file'),
  readAudio: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('audio:read', path),
}

contextBridge.exposeInMainWorld('trainer', api)
export type TrainerApi = typeof api
