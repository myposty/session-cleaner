import { expect, test } from 'claude-code/testing'

test('registers /sessions and leaves /resume to Claude', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: 'C:/project', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual(['sessions'])
})
