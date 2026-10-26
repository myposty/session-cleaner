// Node script the mod pipes into `node --input-type=module -`: the mod
// runtime has no fs delete, so listing and deleting happen here.
//   list <cwd>  -> JSON SessionRow[] for that project, newest first
//   leftovers <id> -> JSON Leftover[]: what the session downloaded or installed
//   delete <id> <current id> -> JSON { ok, removed, freed } | { ok: false, reason };
//     a session open in another Claude process is closed first.
export const HELPER = String.raw`
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'

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

// Live Claude processes from ~/.claude/sessions/<pid>.json: { pid, sessionId, file }.
function liveRecords() {
  const records = []
  const dir = path.join(claudeHome, 'sessions')
  for (const file of readdir(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (typeof record.pid === 'number' && isAlive(record.pid)) {
        records.push({
          pid: record.pid,
          sessionId: record.sessionId,
          file: path.join(dir, file),
          kind: record.kind === 'bg' ? 'bg' : 'terminal',
          cwd: typeof record.cwd === 'string' ? record.cwd : '',
          status: typeof record.status === 'string' ? record.status : '',
        })
      }
    } catch {}
  }
  return records
}

function runningIds() {
  return new Set(liveRecords().map(record => record.sessionId))
}

// The pid must still be a Claude process: a stale record's pid can belong to
// anything by now.
function isClaudeProcess(pid) {
  const run = process.platform === 'win32'
    ? spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { cwd: os.homedir(), encoding: 'utf8', timeout: 15000 })
    : spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { cwd: os.homedir(), encoding: 'utf8', timeout: 15000 })
  return run.status === 0 && /claude|node|bun/i.test(run.stdout || '')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Closes every Claude process that has this session open, by its own pid.
async function closeSession(id) {
  for (const record of liveRecords()) {
    if (record.sessionId !== id) continue
    if (!isClaudeProcess(record.pid)) continue
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { cwd: os.homedir(), timeout: 15000 })
    else try { process.kill(record.pid, 'SIGTERM') } catch {}
    for (let i = 0; i < 50 && isAlive(record.pid); i++) await sleep(100)
    if (isAlive(record.pid)) return false
    try { fs.rmSync(record.file, { force: true }) } catch {}
  }
  return !runningIds().has(id)
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

// "/exit", "/resume abc": a slash command the user ran, for sessions that
// never got a typed prompt.
function commandText(record) {
  const content = record.message && record.message.content
  if (typeof content !== 'string') return ''
  const name = /<command-name>([^<]*)<\/command-name>/.exec(content)
  if (!name) return ''
  const args = /<command-args>([^<]*)<\/command-args>/.exec(content)
  return (name[1].trim() + ' ' + (args ? args[1].trim() : '')).trim()
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
  const commands = []
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
        if (record.type === 'user') {
          first = promptText(record)
          const command = commandText(record)
          if (command && !commands.includes(command)) commands.push(command)
        }
      }
    } catch {}
  }
  const title = custom || ai || summary || first || commands.join(' · ')
  return { title: title ? title.slice(0, 200) : '', firstPrompt: first.slice(0, 600), messages, branch: branch === 'HEAD' ? '' : branch }
}

async function list(cwd) {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  // Where each session is open: one entry per Claude process.
  const openIn = new Map()
  for (const record of liveRecords()) {
    const where = { pid: record.pid, kind: record.kind, cwd: record.cwd, status: record.status }
    openIn.set(record.sessionId, [...(openIn.get(record.sessionId) || []), where])
  }
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
      byId.set(id, { id, title, firstPrompt, messages, branch, mtime: stat.mtimeMs, size: stat.size, openIn: openIn.get(id) || [] })
    }
  }
  return [...byId.values()].sort((a, b) => b.mtime - a.mtime)
}

// What a session left behind outside Claude's folders: dependency and cache
// folders, downloads, models and Python packages. Something counts only when
// it was created while the session ran AND the session's own tool calls name
// it (or the folder it sits in): another session's install is not this one's.
const SLACK = 60000
const JUNK_DIRS = new Set(['node_modules', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'])
const VENV_DIRS = new Set(['.venv', 'venv', 'env'])
const SKIP_WALK = new Set(['.git', 'node_modules', 'target', '.gradle', 'Library', 'DerivedDataCache', 'Intermediate', 'vendor'])
const BIG_FILE = /\.(iso|img|dmg|gguf|ggml|safetensors|onnx|bin|pt|pth|ckpt|h5|tflite|zip|7z|rar|tar|gz|tgz|xz|zst|msi|exe|whl|deb|rpm|appimage|mp4|mkv|wav)$/i
const MIN_FILE = 1024 * 1024
const WALK_DEPTH = 6

function norm(text) {
  const slashed = text.replace(/\\/g, '/')
  return isCaseInsensitive ? slashed.toLowerCase() : slashed
}

function sessionFile(id) {
  for (const dir of readdir(projectsRoot)) {
    const file = path.join(projectsRoot, dir, id + '.jsonl')
    if (fs.existsSync(file)) return file
  }
  return ''
}

function collect(value, out) {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item, out)
}

// The session's working folders, the time it ran and every string its tool
// calls carried (commands, paths, URLs).
async function evidence(file) {
  const cwds = new Set()
  const texts = []
  let start = Infinity
  let end = 0
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    const time = Date.parse(record.timestamp || '')
    if (time) { start = Math.min(start, time); end = Math.max(end, time) }
    if (typeof record.cwd === 'string' && record.cwd) cwds.add(record.cwd)
    const content = record.message && record.message.content
    if (Array.isArray(content)) for (const part of content) if (part && part.type === 'tool_use') collect(part.input, texts)
  }
  return { cwds: [...cwds], text: norm(texts.join('\n')), start: start - SLACK, end: end + SLACK }
}

function bornIn(ev, stat) {
  const born = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs
  return born >= ev.start && born <= ev.end
}

function sizeOf(target) {
  let stat
  try { stat = fs.lstatSync(target) } catch { return 0 }
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const name of readdir(target)) total += sizeOf(path.join(target, name))
  return total
}

// Never a root, the home folder, a folder the session worked in, or anything
// inside a git folder.
function isSafeExtra(target, ev) {
  const resolved = path.resolve(target)
  const same = (a, b) => norm(path.resolve(a)) === norm(path.resolve(b))
  if (resolved.split(path.sep).filter(Boolean).length < 3) return false
  if (same(resolved, os.homedir()) || ev.cwds.some(cwd => same(resolved, cwd))) return false
  return !resolved.split(path.sep).includes('.git')
}

function walk(root, depth, visit) {
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (visit(full, entry.name, true) && depth > 0 && !SKIP_WALK.has(entry.name)) walk(full, depth - 1, visit)
    } else if (entry.isFile()) visit(full, entry.name, false)
  }
}

function findPython() {
  for (const python of ['python', 'python3']) {
    const run = spawnSync(python, ['-c', 'import site,json;print(json.dumps(site.getsitepackages()+[site.getusersitepackages()]))'], { cwd: os.homedir(), encoding: 'utf8', timeout: 15000 })
    if (run.status === 0) {
      try { return { python, sitePackages: JSON.parse(run.stdout.trim()) } } catch {}
    }
  }
  return undefined
}

function packageInfo(distInfo) {
  let name = ''
  try { name = (/^Name:\s*(.+)$/m.exec(fs.readFileSync(path.join(distInfo, 'METADATA'), 'utf8')) || [])[1] || '' } catch {}
  let size = 0
  try {
    for (const line of fs.readFileSync(path.join(distInfo, 'RECORD'), 'utf8').split('\n')) size += Number(line.split(',')[2]) || 0
  } catch {}
  return { name: name.trim(), size }
}

async function leftovers(id) {
  const file = sessionFile(id)
  if (!file) return []
  const ev = await evidence(file)
  if (!Number.isFinite(ev.start)) return []
  const found = new Map()
  const add = (kind, target, size) => {
    if (!found.has(target) && isSafeExtra(target, ev)) found.set(target, { kind, path: target, size: size === undefined ? sizeOf(target) : size })
  }
  const named = text => text !== '' && ev.text.includes(norm(text))
  const home = path.resolve(os.homedir())
  const roots = ev.cwds.filter(dir => fs.existsSync(dir) && path.resolve(dir) !== home && path.resolve(dir).split(path.sep).filter(Boolean).length >= 2)
  // A folder the install ran in: one the session worked in, or one it named.
  const ranIn = dir => named(dir) || roots.some(cwd => {
    const rel = path.relative(cwd, dir)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel) && named(rel))
  })
  const visit = (full, name, isDir) => {
    if (isDir) {
      if (!JUNK_DIRS.has(name)) return true
      if (VENV_DIRS.has(name) && !fs.existsSync(path.join(full, 'pyvenv.cfg'))) return true
      try {
        if (bornIn(ev, fs.statSync(full)) && ranIn(path.dirname(full))) add(name === 'node_modules' ? 'node_modules' : VENV_DIRS.has(name) ? 'venv' : 'cache', full)
      } catch {}
      return false
    }
    if (!BIG_FILE.test(name) || !named(name)) return true
    try {
      const stat = fs.statSync(full)
      if (stat.size >= MIN_FILE && bornIn(ev, stat)) add('file', full, stat.size)
    } catch {}
    return true
  }
  for (const root of roots) walk(root, WALK_DEPTH, visit)
  for (const dir of [path.join(os.homedir(), 'Downloads'), os.tmpdir()]) walk(dir, 0, (full, name, isDir) => isDir ? false : visit(full, name, false))

  // Hugging Face downloads: models--org--name for an org/name the session used.
  const hfHub = process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub')
  for (const name of readdir(hfHub)) {
    const match = /^(models|datasets|spaces)--(.+)$/.exec(name)
    if (!match) continue
    const full = path.join(hfHub, name)
    try {
      if (named(match[2].split('--').join('/')) && bornIn(ev, fs.statSync(full))) add('model', full)
    } catch {}
  }

  // Ollama models the session pulled; "ollama rm" keeps layers others share.
  const ollamaRoot = process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
  for (const match of ev.text.matchAll(/ollama\s+(?:pull|run)\s+([a-z0-9._\/:-]+)/g)) {
    const [model, tag = 'latest'] = match[1].split(':')
    const parts = model.includes('/') ? model.split('/') : ['library', model]
    const manifest = path.join(ollamaRoot, 'manifests', 'registry.ollama.ai', ...parts, tag)
    try {
      if (!bornIn(ev, fs.statSync(manifest))) continue
      const data = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      const size = (data.layers || []).reduce((sum, layer) => sum + (layer.size || 0), 0)
      const key = model + ':' + tag
      if (!found.has(key)) found.set(key, { kind: 'ollama', path: key, size })
    } catch {}
  }

  // Packages "pip install" put in the global Python while the session ran.
  if (/\bpip3?\s+install\b|-m\s+pip\s+install\b/.test(ev.text)) {
    const found_python = findPython()
    for (const dir of found_python ? found_python.sitePackages : []) {
      for (const name of readdir(dir)) {
        if (!name.endsWith('.dist-info')) continue
        try {
          if (!bornIn(ev, fs.statSync(path.join(dir, name)))) continue
          const info = packageInfo(path.join(dir, name))
          if (info.name && !found.has('pip:' + info.name)) found.set('pip:' + info.name, { kind: 'python', path: info.name, size: info.size, python: found_python.python })
        } catch {}
      }
    }
  }
  // A folder inside another one found (a cwd inside node_modules) goes with it.
  const items = [...found.values()]
  const inside = (item, other) => other !== item && other.kind !== 'ollama' && other.kind !== 'python' && norm(item.path).startsWith(norm(other.path) + '/')
  return items.filter(item => !items.some(other => inside(item, other))).sort((a, b) => b.size - a.size)
}

function removeLeftover(item) {
  if (item.kind === 'ollama') return spawnSync('ollama', ['rm', item.path], { cwd: os.homedir(), timeout: 120000 })
  if (item.kind === 'python') return spawnSync(item.python, ['-m', 'pip', 'uninstall', '-y', item.path], { cwd: os.homedir(), timeout: 120000 })
  fs.rmSync(item.path, { recursive: true, force: true })
}

// Only paths whose own name is exactly this session's id (id, id.jsonl,
// id.txt, id.json, id-*.json) directly inside a known Claude folder.
function isOwnPath(target, id, parents) {
  const name = path.basename(target)
  const isOwnName = name === id || name === id + '.jsonl' || name === id + '.txt' || name === id + '.json' || (name.startsWith(id + '-') && name.endsWith('.json'))
  return isOwnName && parents.has(path.resolve(path.dirname(target)))
}

async function remove(id, current) {
  if (!UUID.test(id)) return { ok: false, reason: 'invalid-id' }
  if (id === current) return { ok: false, reason: 'current' }
  if (runningIds().has(id) && !(await closeSession(id))) return { ok: false, reason: 'running' }
  // Read the transcript for leftovers before it is deleted.
  const extras = await leftovers(id)
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
  // One "progress <done> <total>" line per item, for the mod's progress bar.
  const total = extras.length + own.length
  process.stdout.write('progress 0 ' + total + '\n')
  let removed = 0
  const step = () => process.stdout.write('progress ' + ++removed + ' ' + total + '\n')
  for (const item of extras) {
    try { removeLeftover(item) } catch {}
    step()
  }
  for (const target of own) {
    fs.rmSync(target, { recursive: true, force: true })
    step()
  }
  return { ok: true, removed, freed: extras.reduce((sum, item) => sum + item.size, 0) }
}

const [command, arg, current] = process.argv.slice(2)
const result = command === 'list' ? await list(arg)
  : command === 'leftovers' ? (UUID.test(arg || '') ? await leftovers(arg) : [])
  : command === 'delete' ? await remove(arg, current)
  : { ok: false, reason: 'unknown-command' }
// The result is always the last line.
process.stdout.write(JSON.stringify(result) + '\n')
`
