# session-cleaner 🗑

Abrí y borrá conversaciones de Claude Code con `/sessions`.

Escribís `/sessions` y aparece el diálogo propio de Claude con tus sesiones del proyecto (sin la caja de escribir). Elegís una con ↑↓ + Enter y decidís: **Abrir** o **Eliminar 🗑**. Al eliminar, esa conversación desaparece con todos sus temporales. Nada más que esa. `/resume` sigue siendo el original de Claude.

```
 Elegí una sesión (página 1 de 6) · "Type something" busca por título

 ❯ 1. deleter_claude
      ahora · 6.7 MB · abierta
   2. Session-cleaner plugin update
      hace 26 min · 514 KB
   3. vocero
      hace 26 min · 174.1 MB · abierta
   4. Más ▸
      15 sesiones más
   5. Type something.

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
| `Type something` | Busca por título |
| `Abrir` | Retoma la sesión (usa el `/resume` original) |
| `Eliminar 🗑` → `Sí, eliminar` | Borra esa sesión y sus temporales |
| Esc | Cierra |

El diálogo de Claude muestra hasta 4 opciones, por eso la lista va de a 3 sesiones por página. Las sesiones abiertas en otra terminal dicen `abierta` y no se pueden borrar.

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

- `hooks/register.ts`: toma `/resume` sin argumentos, dibuja el panel y maneja los botones. Si algo falla, cae al `/resume` original.
- `hooks/helper.ts`: script de Node que lista y borra. El mod lo ejecuta con `node --input-type=module -` porque el entorno de mods no tiene borrado de archivos.
- `tests/pane.test.ts`: test de la pantalla (`claude plugin test .`).

## Desarrollo

```
claude plugin validate .
claude plugin test .
```

## Licencia

MIT
