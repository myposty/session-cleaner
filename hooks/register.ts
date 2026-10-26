import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { SessionRow } from '../types'
import { HELPER } from './helper'

const PANE = 'session-cleaner'
const sessions = atom({ plugin: 'session-cleaner', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})
const status = atom({ plugin: 'session-cleaner', key: 'status' } as const, '')
const confirming = atom({ plugin: 'session-cleaner', key: 'confirming' } as const, '')
const filter = atom({ plugin: 'session-cleaner', key: 'filter' } as const, '')

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

async function refresh($: EngineInterface) {
  await update($, status, () => 'Cargando sesiones…')
  try {
    const rows = (await helper($, ['list', await $.session.cwd()])) as SessionRow[]
    await update($, sessions, () => rows)
    await update($, status, () => (rows.length === 0 ? 'No hay sesiones en este proyecto.' : ''))
  } catch (error) {
    $.ui.log(`session-cleaner: ${String(error)}`, { to: 'debug' })
    await update($, status, () => 'No se pudieron leer las sesiones.')
  }
}

// Deletes exactly the session confirmed on screen: the id comes from that
// row and must still be the one pending confirmation.
async function remove($: EngineInterface, row: SessionRow) {
  if ((await read($, confirming)) !== row.id) return
  await update($, confirming, () => '')
  try {
    const result = (await helper($, ['delete', row.id])) as { ok: boolean; reason?: string }
    if (!result.ok) {
      $.ui.toast(result.reason === 'running' ? 'Esa sesión está abierta, cerrala primero.' : 'No se pudo eliminar.')
      return
    }
    await update($, sessions, list => list.filter(one => one.id !== row.id))
    $.ui.toast(`Eliminada: ${row.title}`)
  } catch (error) {
    $.ui.log(`session-cleaner: ${String(error)}`, { to: 'debug' })
    $.ui.toast('No se pudo eliminar.')
  }
}

async function resume($: EngineInterface, row: SessionRow) {
  await $.ui.close({ id: PANE })
  await $.command.run({ command: 'resume', args: row.id })
}

function age(now: number, mtime: number) {
  const minutes = Math.floor((now - mtime) / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  const date = new Date(mtime)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

function bytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function fit(text: string, width: number) {
  if (text.length <= width) return text.padEnd(width)
  return `${text.slice(0, Math.max(1, width - 1))}…`
}

export const register: Register = on => {
  on('command.run', { command: 'resume' }, async ($, e, next) => {
    if (e.args.trim() !== '') return next(e)

    await update($, confirming, () => '')
    await update($, filter, () => '')
    await $.ui.open({ id: PANE, title: 'Sesiones', focus: true, closeOnEscape: true })
    await refresh($)

    return {}
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, sessions)
    const message = await read($, status)
    const pending = await read($, confirming)
    const query = (await read($, filter)).toLowerCase()
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const titleWidth = Math.max(10, width - 30)
    const shown = query === '' ? rows : rows.filter(row => row.title.toLowerCase().includes(query))

    let search = null
    if (e.surface === 'terminal') {
      const { Input } = $.ui.resolve(e)
      search = h(Input, {
        key: 'filter',
        placeholder: 'Buscar…',
        onInput: (value: string) => void update($, filter, () => value),
        onSubmit: () => {},
      })
    }

    const confirmRow = (row: SessionRow) =>
      h(Box, { key: `confirm-${row.id}`, flexDirection: 'row' },
        h(Text, { color: 'red' }, `¿Eliminar "${fit(row.title, Math.max(10, titleWidth - 20)).trim()}"? `),
        h(Button, { key: `yes-${row.id}`, label: 'Sí', variant: 'primary', onPress: () => void remove($, row) }),
        h(Text, null, ' '),
        h(Button, { key: `no-${row.id}`, label: 'No', onPress: () => void update($, confirming, () => '') }),
      )

    const sessionRow = (row: SessionRow) =>
      h(Box, { key: `row-${row.id}`, flexDirection: 'row' },
        h(Button, { key: `open-${row.id}`, plain: true, onPress: () => void resume($, row) },
          `${fit(row.title, titleWidth)} `,
          h(Text, { dimColor: true }, `${fit(age(now, row.mtime), 14)}${bytes(row.size).padStart(8)}`),
        ),
        h(Text, null, ' '),
        row.isRunning
          ? h(Text, { dimColor: true }, '·')
          : h(Button, { key: `trash-${row.id}`, plain: true, onPress: () => void update($, confirming, () => row.id) }, '🗑'),
      )

    return h(Box, { flexDirection: 'column' },
      search,
      message !== '' ? h(Text, { dimColor: true }, message) : null,
      ...shown.map(row => (pending === row.id ? confirmRow(row) : sessionRow(row))),
      h(Text, { dimColor: true }, 'Enter abre · 🗑 elimina · · = abierta · Esc cierra'),
    ) as RenderElement
  })
}
