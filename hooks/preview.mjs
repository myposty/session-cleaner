// PreToolUse command hook for AskUserQuestion. A mod's own hooks never see
// the dialogs it opens, and a render hook may not add previews, so /sessions
// leaves each option's grey line and preview in dialog.json and this adds
// them to the call. With previews, Claude draws its preview layout, which has
// no "Type something." row. Any other question passes through untouched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'session-cleaner', 'dialog.json')

let input = ''
for await (const chunk of process.stdin) input += chunk

try {
  const event = JSON.parse(input)
  const dialog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const [first, ...rest] = event.tool_input.questions
  if (event.tool_name !== 'AskUserQuestion' || first.header !== 'Sesiones' || first.question !== dialog.question) process.exit(0)
  const options = first.options.map(option => {
    const extra = dialog.options[option.label] || {}
    return { ...option, description: extra.description || option.description || '', preview: extra.preview || ' ' }
  })
  const updatedInput = { ...event.tool_input, questions: [{ ...first, options }, ...rest] }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } }))
} catch {
  // No dialog file or not ours: leave the call as it is.
}
