export type SessionRow = {
  id: string
  title: string
  firstPrompt: string
  messages: number
  branch: string
  mtime: number
  size: number
  isRunning: boolean
}

// Something a session downloaded or installed; `path` is the package or
// model name for `python` and `ollama`.
export type Leftover = {
  kind: 'node_modules' | 'venv' | 'cache' | 'file' | 'model' | 'ollama' | 'python'
  path: string
  size: number
}
