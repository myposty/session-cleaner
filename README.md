# session-cleaner 🗑

Borrá conversaciones de Claude Code desde `/resume`, con un 🗑 al lado de cada una.

Escribís `/resume`, ves tus sesiones del proyecto como siempre, y cada una tiene un 🗑. Lo tocás, confirmás, y esa conversación desaparece con todos sus temporales. Nada más que esa.

```
 Sesiones
 ─────────────────────────────────────────────────────────────
  End of era tribute site        hace 2 h        14.0 MB   🗑
  vocero                         hace 5 min       3.1 MB   ·
  Fix bracket ESPN               ayer           800 KB     🗑
 ─────────────────────────────────────────────────────────────
  Enter abre · 🗑 elimina · · = abierta · Esc cierra
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
| `/resume` | Abre la lista de sesiones del proyecto actual |
| Escribir arriba | Filtra por título |
| Enter sobre una sesión | La abre (usa el `/resume` original) |
| Click en 🗑 | Pregunta `¿Eliminar "…"? [Sí] [No]` |
| Sí | Borra esa sesión y sus temporales |
| Esc | Cierra la lista |
| `/resume <id>` | Va directo al `/resume` original, sin la lista |

Las sesiones abiertas en otra terminal se marcan con `·` y no se pueden borrar.

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
