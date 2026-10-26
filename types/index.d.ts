export type SessionRow = {
  id: string
  title: string
  mtime: number
  size: number
  isRunning: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-cleaner': {
      sessions: Shaped<SessionRow[]>
      status: string
      confirming: string
      filter: string
    }
  }
}
