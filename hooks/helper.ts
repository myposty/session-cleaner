// Node script the mod pipes into `node --input-type=module -`: the mod
// runtime has no fs delete, so listing and deleting happen here.
//   list <cwd>  -> JSON SessionRow[] for that project, newest first
//   delete <id> -> JSON { ok, removed } | { ok: false, reason }
export const HELPER = String.raw`
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'

const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const projectsRoot = path.join(claudeHome, 'projects')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Windows and macOS file systems ignore case; Linux does not.
const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
// Claude cuts long project folder names and appends a hash.
const MAX_PROJECT_NAME = 200

function readdir(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return Boolean(error && error.code === 'EPERM')
  }
}

function runningIds() {
  const ids = new Set()
  const dir = path.join(claudeHome, 'sessions')
  for (const file of readdir(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (typeof record.pid === 'number' && isAlive(record.pid)) ids.add(record.sessionId)
    } catch {}
  }
  return ids
}

function isProjectDir(dir, key) {
  const name = isCaseInsensitive ? dir.toLowerCase() : dir
  const wanted = isCaseInsensitive ? key.toLowerCase() : key
  if (wanted.length <= MAX_PROJECT_NAME) return name === wanted
  return name.startsWith(wanted.slice(0, MAX_PROJECT_NAME))
}

// Where Claude keeps per-session temp folders: <tmp>/claude on Windows,
// <tmp>/claude-<uid> on macOS and Linux.
function tempRoots() {
  const bases = new Set([os.tmpdir(), '/tmp'])
  const names = ['claude']
  if (typeof process.getuid === 'function') names.push('claude-' + process.getuid())
  const roots = []
  for (const base of bases) for (const name of names) roots.push(path.join(base, name))
  return roots
}

function promptText(record) {
  if (record.isMeta || record.isSidechain) return ''
  const content = record.message && record.message.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const block = content.find(part => part && part.type === 'text')
    text = block ? block.text : ''
  }
  text = text.trim()
  if (text.startsWith('<')) return ''
  return text.replace(/\s+/g, ' ')
}

async function summarize(file) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let custom = ''
  let ai = ''
  let summary = ''
  let first = ''
  let messages = 0
  let branch = ''
  for await (const line of lines) {
    if (line.startsWith('{"parentUuid"') && line.includes('"isSidechain":false') && !line.includes('"isMeta":true')) {
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) messages++
      const found = line.match(/"gitBranch":"([^"]*)"/)
      if (found) branch = found[1]
    }
    try {
      if (line.startsWith('{"type":"custom-title"')) custom = JSON.parse(line).customTitle || custom
      else if (line.startsWith('{"type":"ai-title"')) ai = JSON.parse(line).aiTitle || ai
      else if (line.startsWith('{"type":"summary"')) summary = JSON.parse(line).summary || summary
      else if (!first && line.includes('"type":"user"')) {
        const record = JSON.parse(line)
        if (record.type === 'user') first = promptText(record)
      }
    } catch {}
  }
  const title = custom || ai || summary || first
  return { title: title ? title.slice(0, 200) : '', firstPrompt: first.slice(0, 600), messages, branch: branch === 'HEAD' ? '' : branch }
}

async function list(cwd) {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  const running = runningIds()
  const byId = new Map()
  for (const dir of readdir(projectsRoot)) {
    if (!isProjectDir(dir, key)) continue
    for (const name of readdir(path.join(projectsRoot, dir))) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -6)
      if (!UUID.test(id) || byId.has(id)) continue
      const file = path.join(projectsRoot, dir, name)
      const stat = fs.statSync(file)
      const { title, firstPrompt, messages, branch } = await summarize(file)
      if (!title) continue
      byId.set(id, { id, title, firstPrompt, messages, branch, mtime: stat.mtimeMs, size: stat.size, isRunning: running.has(id) })
    }
  }
  return [...byId.values()].sort((a, b) => b.mtime - a.mtime)
}

// Only paths whose own name is exactly this session's id (id, id.jsonl,
// id.txt, id.json, id-*.json) directly inside a known Claude folder.
function isOwnPath(target, id, parents) {
  const name = path.basename(target)
  const isOwnName = name === id || name === id + '.jsonl' || name === id + '.txt' || name === id + '.json' || (name.startsWith(id + '-') && name.endsWith('.json'))
  return isOwnName && parents.has(path.resolve(path.dirname(target)))
}

function remove(id) {
  if (!UUID.test(id)) return { ok: false, reason: 'invalid-id' }
  if (runningIds().has(id)) return { ok: false, reason: 'running' }
  const parents = new Set()
  const targets = []
  const add = (parent, name) => {
    parents.add(path.resolve(parent))
    targets.push(path.join(parent, name))
  }
  add(path.join(claudeHome, 'session-env'), id)
  add(path.join(claudeHome, 'file-history'), id)
  add(path.join(claudeHome, 'debug'), id + '.txt')
  for (const dir of readdir(projectsRoot)) {
    add(path.join(projectsRoot, dir), id + '.jsonl')
    add(path.join(projectsRoot, dir), id)
  }
  const todos = path.join(claudeHome, 'todos')
  for (const name of readdir(todos)) {
    if (name === id + '.json' || (name.startsWith(id + '-') && name.endsWith('.json'))) add(todos, name)
  }
  for (const tempRoot of tempRoots()) {
    for (const dir of readdir(tempRoot)) add(path.join(tempRoot, dir), id)
  }
  const own = targets.filter(target => isOwnPath(target, id, parents) && fs.existsSync(target))
  // One "progress <done> <total>" line per path, for the mod's progress bar.
  process.stdout.write('progress 0 ' + own.length + '\n')
  let removed = 0
  for (const target of own) {
    fs.rmSync(target, { recursive: true, force: true })
    removed++
    process.stdout.write('progress ' + removed + ' ' + own.length + '\n')
  }
  return { ok: true, removed }
}

const [command, arg] = process.argv.slice(2)
const result = command === 'list' ? await list(arg) : command === 'delete' ? remove(arg) : { ok: false, reason: 'unknown-command' }
// The result is always the last line.
process.stdout.write(JSON.stringify(result) + '\n')
`
