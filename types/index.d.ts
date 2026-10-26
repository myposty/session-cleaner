export type SessionRow = {
  id: string
  title: string
  messages: number
  branch: string
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
      focused: string
    }
  }
}
