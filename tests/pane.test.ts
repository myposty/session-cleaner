import { expect, test } from 'claude-code/testing'

const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Sesion A', messages: 12, branch: 'main', mtime: 0, size: 2048, isRunning: false }
const B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Sesion B', messages: 3, branch: '', mtime: 0, size: 4096, isRunning: false }
const OPEN = { id: 'cccccccc-0000-4000-8000-000000000003', title: 'Sesion abierta', messages: 1200, branch: '', mtime: 0, size: 1, isRunning: true }

const PANE = {
  plugin: 'session-cleaner',
  component: 'Pane',
  requestId: 'session-cleaner',
  surface: 'terminal',
  props: {
    title: 'Sesiones',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the trash deletes only the confirmed session', async ($, on) => {
  const helperCalls: string[][] = []
  const helperCwds: (string | undefined)[] = []
  const resumed: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/dummy' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: 'C:/project/sub' }))
  on('session.root', () => ({ value: 'C:/project' }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(3)
    helperCalls.push(args)
    helperCwds.push(e.init?.cwd)
    const stdout = args[0] === 'list' ? JSON.stringify([A, B, OPEN]) : JSON.stringify({ ok: true, removed: 5 })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', (_, e) => {
    resumed.push(e.args)
    return {}
  })

  await $.command.run({ command: 'resume', args: '' })
  const ui = await $.ui.mount(PANE)

  // Lists the folder the session started in, not where it cd'd to.
  expect(helperCalls[0]).toEqual(['list', 'C:/project'])
  expect(await ui.find({ key: `trash-${A.id}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /12 mensajes · main · 2 KB/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\.200 mensajes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯' })).toBeDefined()
  expect(await ui.find({ key: `trash-${B.id}` })).toBeDefined()
  expect(await ui.find({ key: `trash-${OPEN.id}` })).toBeUndefined()

  await ui.press({ key: `trash-${A.id}` })
  expect((await ui.find({ type: 'Text', text: /Eliminar "Sesion A"/ }))?.text).toContain('Sesion A')
  expect(helperCalls.filter(call => call[0] === 'delete')).toEqual([])

  await ui.press({ key: `yes-${A.id}` })
  expect(helperCalls.filter(call => call[0] === 'delete')).toEqual([['delete', A.id]])
  expect(await ui.find({ key: `open-${A.id}` })).toBeUndefined()
  expect(await ui.find({ key: `open-${B.id}` })).toBeDefined()

  await ui.press({ key: `trash-${B.id}` })
  await ui.press({ key: `no-${B.id}` })
  expect(helperCalls.filter(call => call[0] === 'delete')).toEqual([['delete', A.id]])
  expect(await ui.find({ key: `open-${B.id}` })).toBeDefined()

  await ui.press({ key: `open-${B.id}` })
  expect(resumed).toEqual([B.id])
  // node never runs from the project folder (C:/project).
  expect(helperCwds.every(cwd => cwd === '/home/dummy')).toBe(true)
  await ui.unmount()
})
