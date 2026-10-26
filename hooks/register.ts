import type { EngineInterface, Register } from 'claude-code'

import type { Leftover, SessionRow } from '../types'
import { HELPER } from './helper'

// /sessions uses Claude's own question dialog: it hides the prompt and owns
// the arrow keys, like the built-in /resume. The dialog holds at most 4
// options (Claude validates it, even on a redraw), so the list is paged:
// 3 sessions and a "Más" option. Its free-text "Other" searches by title.
const PAGE = 3
const MORE = 'Más ▸'
const FIRST = '◂ Volver al inicio'
const OPEN = 'Abrir'
const DELETE = 'Eliminar 🗑'
const BACK = 'Volver'
const CONFIRM = 'Sí, eliminar'
const CANCEL = 'Cancelar'

// Option label -> grey line and preview, for the dialog that is up.
type Extra = { description?: string; preview: string }

function count(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// Runs from the user's home, never the project folder: some platforms look up
// a bare `node` in the working directory first, so an untrusted repo could
// plant its own node binary.
async function homeDir($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  if (!home) throw new Error('no USERPROFILE or HOME to run node from')

  return home
}

async function helper($: EngineInterface, args: string[]): Promise<unknown> {
  const run = await $.process.run(['node', '--input-type=module', '-', ...args], {
    cwd: await homeDir($),
    stdin: HELPER,
    timeoutMs: 120_000,
  })
  if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 500))

  return JSON.parse(lastLine(run.stdout))
}

function lastLine(text: string) {
  return text.trim().split('\n').pop() ?? ''
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function bar(percent: number) {
  const filled = Math.round(percent / 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`
}

// Looks for what the session downloaded or installed, with a spinner.
async function findLeftovers($: EngineInterface, id: string) {
  let frame = 0
  const draw = () => $.ui.status(`${SPINNER[frame++ % SPINNER.length]} Buscando lo que bajó o instaló esta sesión…`)
  draw()
  const stop = $.clock.every(80, draw)
  try {
    return (await helper($, ['leftovers', id])) as Leftover[]
  } catch (error) {
    $.ui.log(`session-cleaner: ${String(error)}`, { to: 'debug' })
    return []
  } finally {
    stop.cancel()
    $.ui.status(undefined)
  }
}

const KIND: Record<Leftover['kind'], string> = {
  node_modules: 'node_modules',
  venv: 'Entorno Python',
  cache: 'Caché',
  file: 'Descarga',
  model: 'Modelo',
  ollama: 'Modelo Ollama',
  python: 'Librería Python',
}

function shortPath(text: string) {
  return text.length > 60 ? `…${text.slice(-59)}` : text
}

function leftoversPreview(items: Leftover[]) {
  if (items.length === 0) return 'No bajó ni instaló nada fuera de Claude.'
  const total = items.reduce((sum, item) => sum + item.size, 0)
  const lines = [`También lo que bajó o instaló (${bytes(total)}):`]
  for (const item of items.slice(0, 12)) lines.push(`• ${KIND[item.kind]}  ${bytes(item.size)}`, `  ${shortPath(item.path)}`)
  if (items.length > 12) lines.push(`… y ${items.length - 12} más`)
  return lines.join('\n')
}

// Deletes with a live status line: spinner, bar and percentage, fed by the
// helper's "progress <done> <total>" lines.
async function deleteWithProgress($: EngineInterface, id: string, title: string) {
  let percent = 0
  let frame = 0
  const draw = () => $.ui.status(`${SPINNER[frame++ % SPINNER.length]} Eliminando "${title}"  ${bar(percent)} ${percent}%`)
  draw()
  const stop = $.clock.every(80, draw)
  let output = ''
  try {
    const current = await $.session.id()
    const stream = $.process.spawn({ argv: ['node', '--input-type=module', '-', 'delete', id, current], cwd: await homeDir($), input: HELPER })
    for await (const chunk of stream) {
      if (chunk.stream !== 'stdout') continue
      output += chunk.text
      for (const line of output.split('\n')) {
        const match = /^progress (\d+) (\d+)$/.exec(line.trim())
        if (match) percent = Number(match[2]) === 0 ? 100 : Math.round((Number(match[1]) / Number(match[2])) * 100)
      }
    }
    return JSON.parse(lastLine(output)) as { ok: boolean; reason?: string; freed?: number }
  } finally {
    stop.cancel()
    $.ui.status(undefined)
  }
}

// Sessions are stored under the folder the session started in (what the
// built-in /resume lists), not wherever the session has cd'd since.
async function loadSessions($: EngineInterface) {
  const root = await $.session.root()
  let rows = (await helper($, ['list', root])) as SessionRow[]
  const cwd = await $.session.cwd()
  if (rows.length === 0 && cwd !== root) rows = (await helper($, ['list', cwd])) as SessionRow[]

  return rows
}

function age(now: number, mtime: number) {
  const minutes = Math.floor((now - mtime) / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const date = new Date(mtime)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

function bytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// Emoji in a title draw two cells wide in most terminals but count as one.
function clean(text: string) {
  return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim()
}

function details(now: number, row: SessionRow) {
  const parts = [age(now, row.mtime)]
  if (row.branch !== '') parts.push(row.branch)
  parts.push(bytes(row.size))
  if (row.isRunning) parts.push('abierta')
  return parts.join(' · ')
}

// One unique label per session: repeated titles get their age appended.
function labelSessions(now: number, rows: SessionRow[]) {
  const labels = new Map<string, SessionRow>()
  for (const row of rows) {
    const title = clean(row.title).slice(0, 80) || 'Sin título'
    let label = title
    if (labels.has(label)) label = `${title} (${age(now, row.mtime)})`
    for (let n = 2; labels.has(label); n++) label = `${title} (${n})`
    labels.set(label, row)
  }
  return labels
}

// Every option gets a preview: with one, Claude draws its preview layout
// (list left, preview right) and leaves out the "Type something." row.
// "Chat about this" is fixed in both layouts; picked, it closes like Esc.
// Where hooks/preview.mjs picks up the open dialog's previews.
async function dialogFile($: EngineInterface) {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
  return `${config}/session-cleaner/dialog.json`
}

async function ask($: EngineInterface, question: string, options: string[], previews: Map<string, Extra>) {
  const file = await dialogFile($)
  await $.fs.write(file, JSON.stringify({ question, options: Object.fromEntries(previews) }))
  try {
    const answer = await $.ui.ask(question, { options, header: 'Sesiones' })
    return /^chat about this$/i.test(answer.trim()) ? undefined : answer
  } catch {
    return undefined // Esc
  } finally {
    await $.fs.write(file, '{}')
  }
}

function sessionPreview(now: number, row: SessionRow) {
  const lines = [clean(row.title), details(now, row), `${count(row.messages)} mensajes`]
  if (row.firstPrompt !== '') lines.push('', 'Primer mensaje:', clean(row.firstPrompt))
  return lines.join('\n')
}

async function remove($: EngineInterface, row: SessionRow) {
  const title = clean(row.title)
  try {
    const result = await deleteWithProgress($, row.id, title)
    if (result.ok) $.ui.toast(result.freed ? `✓ Eliminada: ${title} · ${bytes(result.freed)} liberados` : `✓ Eliminada: ${title}`)
    else $.ui.toast(result.reason === 'current' ? 'No podés eliminar la sesión en la que estás.' : result.reason === 'running' ? 'No se pudo cerrar la ventana donde está abierta.' : 'No se pudo eliminar.')
  } catch (error) {
    $.ui.log(`session-cleaner: ${String(error)}`, { to: 'debug' })
    $.ui.toast('No se pudo eliminar.')
  }
}

// Shows pages of sessions until one is picked; undefined on Esc.
async function pickSession($: EngineInterface, rows: SessionRow[]) {
  const now = await $.clock.now()
  let pool = rows
  let page = 0
  for (;;) {
    const pages = Math.max(1, Math.ceil(pool.length / PAGE))
    const labels = labelSessions(now, pool.slice(page * PAGE, page * PAGE + PAGE))
    const options = [...labels.keys()]
    if (pages > 1) options.push(page + 1 < pages ? MORE : FIRST)
    if (options.length < 2) options.push(FIRST)
    const previews = new Map<string, Extra>([...labels].map(([label, row]) => [label, { description: details(now, row), preview: sessionPreview(now, row) }]))
    const left = pool.length - (page + 1) * PAGE
    previews.set(MORE, { description: `${left} sesiones más`, preview: `Ver las siguientes ${Math.min(PAGE, left)} de ${left} sesiones.` })
    previews.set(FIRST, { preview: 'Volver a la primera página.' })

    const question = pages > 1 ? `Elegí una sesión (página ${page + 1} de ${pages})` : 'Elegí una sesión'
    const answer = await ask($, question, options, previews)
    if (answer === undefined) return undefined
    if (answer === MORE) { page++; continue }
    if (answer === FIRST) { pool = rows; page = 0; continue }
    const row = labels.get(answer)
    if (row) return row
    // Free text from "Other": search by title.
    const query = answer.toLowerCase()
    pool = rows.filter(one => one.title.toLowerCase().includes(query))
    page = 0
    if (pool.length === 0) {
      $.ui.toast(`Ninguna sesión contiene "${answer}"`)
      pool = rows
    }
  }
}

async function browse($: EngineInterface) {
  for (;;) {
    let rows: SessionRow[]
    try {
      rows = await loadSessions($)
    } catch (error) {
      $.ui.log(`session-cleaner: ${String(error)}`, { to: 'debug' })
      $.ui.toast('No se pudieron leer las sesiones.')
      return
    }
    if (rows.length === 0) {
      $.ui.toast('No hay sesiones en este proyecto.')
      return
    }

    const row = await pickSession($, rows)
    if (!row) return

    const title = clean(row.title)
    const now = await $.clock.now()
    const summary = sessionPreview(now, row)
    // The dialog needs two options at least, so the current session gets a toast.
    if (row.id === (await $.session.id())) {
      $.ui.toast('Es la sesión en la que estás: no se puede eliminar desde acá.')
      continue
    }
    const closes = row.isRunning ? 'Está abierta en otra ventana: se cierra esa ventana y se borra.\n' : ''
    const action = await ask($, `"${title}"`, [OPEN, DELETE, BACK], new Map<string, Extra>([
      [OPEN, { preview: `Retomar esta conversación.\n\n${summary}` }],
      [DELETE, { preview: `Borra esta conversación y sus temporales.\n${closes}Te pide confirmación.\n\n${summary}` }],
      [BACK, { preview: 'Volver a la lista.' }],
    ]))
    if (action === OPEN) {
      await $.command.run({ command: 'resume', args: row.id })
      return
    }
    if (action === DELETE) {
      const extra = leftoversPreview(await findLeftovers($, row.id))
      const sure = await ask($, `¿Eliminar "${title}"? No se puede deshacer.`, [CONFIRM, CANCEL], new Map<string, Extra>([
        [CONFIRM, { preview: `${closes}Se borra para siempre:\n\n${summary}\n\n${extra}` }],
        [CANCEL, { preview: 'No se borra nada.' }],
      ]))
      if (sure === CONFIRM) await remove($, row)
    }
    if (action === undefined) return
    // Volver, Cancelar or a finished delete: show the list again.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sessions', description: 'Ver, abrir y eliminar las sesiones de este proyecto' })

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    // The dialog runs after the command returns: a hook the turn waits on
    // cannot hold a question open.
    $.clock.after(0, () => void browse($))

    return {}
  })
}
