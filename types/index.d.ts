export type SessionRow = {
  id: string
  title: string
  firstPrompt: string
  messages: number
  branch: string
  mtime: number
  size: number
  // The Claude processes that have this session open; empty when closed.
  openIn: OpenIn[]
}

export type OpenIn = {
  pid: number
  kind: 'terminal' | 'bg'
  // The folder that process is working in.
  cwd: string
  // Claude's own word: 'busy', 'idle', 'waiting'.
  status: string
}

// Something a session downloaded or installed; `path` is the package or
// model name for `python` and `ollama`.
export type Leftover = {
  kind: 'node_modules' | 'venv' | 'cache' | 'file' | 'model' | 'ollama' | 'python'
  path: string
  size: number
}
