import { expect, mock, test } from 'claude-code/testing'

import type { SessionRow } from '../types'

const NOW = Date.parse('2026-10-26T18:00:00Z')

const row = (id: string, title: string, openIn: SessionRow['openIn']): SessionRow => ({
  id, title, firstPrompt: '', messages: 4, branch: '', mtime: NOW - 120_000, size: 2048, openIn,
})

const ROWS = [
  row('aaaaaaaa-0000-4000-8000-000000000001', 'esta', [{ pid: 1, kind: 'terminal', cwd: 'C:\\p', status: 'busy' }]),
  row('aaaaaaaa-0000-4000-8000-000000000002', 'vocero', [{ pid: 2628, kind: 'terminal', cwd: 'C:\\p\\vocero', status: 'idle' }]),
  row('aaaaaaaa-0000-4000-8000-000000000003', 'job', [{ pid: 22172, kind: 'bg', cwd: 'C:\\p', status: 'idle' }]),
]

test('the list says where each open session is', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: ROWS[0]!.id }))
  on('session.root', () => ({ value: 'C:/p' }))
  on('session.cwd', () => ({ value: 'C:/p' }))
  on('env.get', () => ({ value: 'C:/home' }))
  const written: string[] = []
  on('fs.write', (_, e) => {
    written.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${JSON.stringify(ROWS)}\n`, stderr: '' } }))
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'dismissed' }))

  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sessions', args: '' })
  await clock.settle()

  // hooks/preview.mjs reads this file to draw each option's grey line.
  const dialog = JSON.parse(written[0] ?? '{}') as { options: Record<string, { description?: string; preview: string }> }
  const descriptions = Object.fromEntries(Object.entries(dialog.options).map(([label, extra]) => [label, extra.description]))
  expect(descriptions['esta']).toBe('hace 2 min · 2 KB · esta sesión')
  expect(descriptions['vocero']).toBe('hace 2 min · 2 KB · abierta en otra terminal (vocero)')
  expect(dialog.options['vocero']?.preview).toContain('Abierta en otra terminal · carpeta C:\\p\\vocero · sin actividad · PID 2628')
  expect(dialog.options['esta']?.preview).toContain('Es la sesión en la que estás.')
  expect(descriptions['job']).toBe('hace 2 min · 2 KB · abierta en segundo plano (p)')
})
