import type { EngineInterface, Register } from 'claude-code'

import type { SessionRow } from '../types'
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

// Option label -> grey line under it, for the dialog that is up.
let descriptions = new Map<string, string>()

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

  return JSON.parse(run.stdout)
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

async function ask($: EngineInterface, question: string, options: string[]) {
  try {
    return await $.ui.ask(question, { options, header: 'Sesiones' })
  } catch {
    return undefined // Esc
  }
}

async function remove($: EngineInterface, row: SessionRow) {
  const result = (await helper($, ['delete', row.id])) as { ok: boolean; reason?: string }
  if (result.ok) $.ui.toast(`Eliminada: ${clean(row.title)}`)
  else $.ui.toast(result.reason === 'running' ? 'Esa sesión está abierta, cerrala primero.' : 'No se pudo eliminar.')
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
    descriptions = new Map([...labels].map(([label, row]) => [label, details(now, row)]))
    descriptions.set(MORE, `${pool.length - (page + 1) * PAGE} sesiones más`)

    const question = pages > 1 ? `Elegí una sesión (página ${page + 1} de ${pages}) · "Type something" busca por título` : 'Elegí una sesión · "Type something" busca por título'
    const answer = await ask($, question, options)
    descriptions = new Map()
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
    const actions = row.isRunning ? [OPEN, BACK] : [OPEN, DELETE, BACK]
    const action = await ask($, `"${title}"`, actions)
    if (action === OPEN) {
      await $.command.run({ command: 'resume', args: row.id })
      return
    }
    if (action === DELETE) {
      const sure = await ask($, `¿Eliminar "${title}"? No se puede deshacer.`, [CONFIRM, CANCEL])
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

  // Add the grey "time · branch · size" line under each session option.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (descriptions.size === 0) return next(e)
    const questions = e.props.questions as { options?: { label: string; description?: string }[] }[]
    const first = questions[0]
    if (!first?.options) return next(e)
    const options = first.options.map(option => ({ ...option, description: descriptions.get(option.label) ?? option.description ?? '' }))

    return next({ ...e, props: { ...e.props, questions: [{ ...first, options }, ...questions.slice(1)] } })
  })
}
