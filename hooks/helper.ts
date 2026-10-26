// Node script the mod pipes into `node --input-type=module -`: the mod
// runtime has no fs delete, so listing and deleting happen here.
//   list <cwd>  -> JSON SessionRow[] for that project, newest first
//   delete <id> -> JSON { ok, removed } | { ok: false, reason }
export const HELPER = String.raw`
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'

const claudeHome = path.join(os.homedir(), '.claude')
const projectsRoot = path.join(claudeHome, 'projects')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function readdir(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function runningIds() {
  const ids = new Set()
  const dir = path.join(claudeHome, 'sessions')
  for (const file of readdir(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      process.kill(record.pid, 0)
      ids.add(record.sessionId)
    } catch {}
  }
  return ids
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
  for await (const line of lines) {
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
  return title ? title.slice(0, 200) : ''
}

async function list(cwd) {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const running = runningIds()
  const byId = new Map()
  for (const dir of readdir(projectsRoot)) {
    if (dir.toLowerCase() !== key) continue
    for (const name of readdir(path.join(projectsRoot, dir))) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -6)
      if (!UUID.test(id) || byId.has(id)) continue
      const file = path.join(projectsRoot, dir, name)
      const stat = fs.statSync(file)
      const title = await summarize(file)
      if (!title) continue
      byId.set(id, { id, title, mtime: stat.mtimeMs, size: stat.size, isRunning: running.has(id) })
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
  const tempRoot = path.join(os.tmpdir(), 'claude')
  for (const dir of readdir(tempRoot)) add(path.join(tempRoot, dir), id)
  let removed = 0
  for (const target of targets) {
    if (!isOwnPath(target, id, parents) || !fs.existsSync(target)) continue
    fs.rmSync(target, { recursive: true, force: true })
    removed++
  }
  return { ok: true, removed }
}

const [command, arg] = process.argv.slice(2)
const result = command === 'list' ? await list(arg) : command === 'delete' ? remove(arg) : { ok: false, reason: 'unknown-command' }
process.stdout.write(JSON.stringify(result))
`
