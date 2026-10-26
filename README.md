# session-cleaner 🗑

Abrí y borrá conversaciones de Claude Code con `/sessions`.

Escribís `/sessions` y aparece el diálogo propio de Claude con tus sesiones del proyecto (sin la caja de escribir). Elegís una con ↑↓ + Enter y decidís: **Abrir** o **Eliminar 🗑**. Al eliminar, esa conversación desaparece con todos sus temporales. Nada más que esa. `/resume` sigue siendo el original de Claude.

```
 Elegí una sesión (página 1 de 6)

 ❯ 1. deleter_claude        │ deleter_claude
   2. vocero                │ ahora · main · 6.7 MB · abierta
   3. Session-cleaner…      │ 412 mensajes
   4. Más ▸                 │
                            │ Primer mensaje:
                            │ como se hacen aplicaciones…

 Enter to select · ↑/↓ to navigate · Esc to cancel
```

## Instalar

Requisitos: Claude Code con soporte de mods y Node.js 18+ en el PATH. Funciona en Windows, macOS y Linux, y respeta `CLAUDE_CONFIG_DIR` si movés la carpeta de Claude.

En una sesión de Claude Code:

```
/plugin install session-cleaner --marketplace myposty/session-cleaner
```

Desde la terminal:

```
claude plugin install session-cleaner --marketplace myposty/session-cleaner
```

Respondé `y` para agregar el marketplace y elegí el scope `user` para tenerlo en todos tus proyectos.

### Desde una carpeta local (sin GitHub)

```
claude plugin marketplace add "C:\ruta\a\session-cleaner"
claude plugin install session-cleaner@session-cleaner
```

O solo para una sesión: `claude --plugin-dir "C:\ruta\a\session-cleaner"`.

## Usar

| Acción | Qué hace |
| --- | --- |
| `/sessions` | Abre la lista de sesiones del proyecto actual |
| ↑↓ + Enter | Elige una sesión |
| `Más ▸` | Siguientes 3 sesiones |
| `Abrir` | Retoma la sesión (usa el `/resume` original) |
| `Eliminar 🗑` → `Sí, eliminar` | Borra esa sesión y sus temporales |
| Esc | Cierra |

El diálogo de Claude muestra hasta 4 opciones, por eso la lista va de a 3 sesiones por página. A la derecha ves el detalle de la sesión marcada. Las sesiones abiertas en otra terminal dicen `abierta` y no se pueden borrar.

## Qué borra exactamente

Solo rutas cuyo nombre es **exactamente** el id de la sesión elegida, dentro de las carpetas de Claude:

- `~/.claude/projects/<proyecto>/<id>.jsonl`: la conversación
- `~/.claude/projects/<proyecto>/<id>/`: subagentes y resultados de herramientas
- `~/.claude/session-env/<id>/`
- `~/.claude/file-history/<id>/`
- `~/.claude/debug/<id>.txt`
- `~/.claude/todos/<id>-*.json`
- `<temp>/claude/<proyecto>/<id>/` (Windows) o `/tmp/claude-<uid>/<proyecto>/<id>/` (macOS/Linux): scratchpad y temporales

`~/.claude` es `CLAUDE_CONFIG_DIR` si lo tenés definido.

No toca otras sesiones, ni `history.jsonl`, ni configuración. Rechaza ids que no sean un UUID y sesiones que estén abiertas.

## Seguridad

- Borrar exige dos clicks en la pantalla (🗑 y después **Sí**). Ni el modelo ni otro plugin pueden apretar esos botones.
- El script corre `node` desde tu carpeta de usuario, nunca desde el proyecto, para que un repo ajeno no pueda colar su propio `node`.
- Sin shell: los argumentos van como lista y el script entra por stdin.

**Borrar no se puede deshacer.**

## Cómo funciona

Es un mod de Claude Code (function hooks):

- `hooks/register.ts`: registra `/sessions`, arma las páginas con el diálogo de preguntas de Claude y muestra el progreso al borrar.
- `hooks/preview.mjs`: hook `PreToolUse` que agrega la vista previa a las opciones de `/sessions` (deja `~/.claude/session-cleaner/dialog.json`). Con vista previa, Claude no muestra la fila "Type something.". Las preguntas de otros no las toca.
- `hooks/helper.ts`: script de Node que lista y borra. El mod lo ejecuta con `node --input-type=module -` porque el entorno de mods no tiene borrado de archivos.
- `tests/pane.test.ts`: test de la pantalla (`claude plugin test .`).

## Desarrollo

```
claude plugin validate .
claude plugin test .
```

## Licencia

MIT
