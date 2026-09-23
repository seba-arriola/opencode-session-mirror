# opencode-session-mirror

Real-time, **restorable** backup of your [OpenCode](https://opencode.ai) **V2** sessions.

A local OpenCode plugin mirrors everything that happens in every session — prompts, assistant
messages, reasoning, tool calls, shell commands, model/agent switches and compactions — to disk
**as it happens**, in the exact `{ info, messages }` shape that `opencode session import` accepts.
A companion CLI lists, verifies and restores those snapshots, and a local git repository versions
them.

If OpenCode's database (`~/.local/share/opencode/opencode.db`) is deleted or recreated, your
sessions are gone — OpenCode keeps no separate history. This plugin keeps an independent copy
**outside** the data directory so you can bring them back.

---

## Requirements

- **OpenCode V2** (`opencode --version` → `2.x`)
- **`python3`** — for the CLI
- **`git`** — for local versioning of the mirror
- A POSIX shell (`bash`/`zsh`)

No npm, no sudo, no background daemons. The plugin only uses Node built-ins.

---

## Install

### From this repository

```bash
git clone git@github.com:seba-arriola/opencode-session-mirror.git
cd opencode-session-mirror
./install.sh
```

`install.sh` options:

| Option | Effect |
|---|---|
| *(none)* | Copy the plugin and CLI into place. |
| `--link` | Symlink instead of copy. Best if you edit the repo: changes reload the plugin live. |
| `--dry-run` | Print what would be done, change nothing. |
| `-h`, `--help` | Show help. |

What it installs:

| From | To |
|---|---|
| `plugin/session-mirror.ts` | `~/.config/opencode/plugins/session-mirror.ts` |
| `bin/opencode-mirror` | `~/.local/bin/opencode-mirror` (executable) |

OpenCode auto-discovers plugins under `~/.config/opencode/plugins/`, so **no config change and no
restart are needed** — the config watcher reloads the plugin as soon as the file appears.

> If `~/.local/bin` is not in your `PATH`, the installer tells you the line to add to your shell
> profile.

### Manual install

```bash
cp plugin/session-mirror.ts ~/.config/opencode/plugins/
install -m 755 bin/opencode-mirror ~/.local/bin/opencode-mirror
```

### Update

```bash
cd opencode-session-mirror
git pull
./install.sh
```

### Uninstall

```bash
./uninstall.sh            # removes the plugin and the CLI, keeps your mirror
./uninstall.sh --purge    # also deletes ~/.local/share/opencode-mirror
```

---

## How it works

The plugin is instantiated once per loaded OpenCode *location* (project). Each instance subscribes
to the global event stream and processes only the events of its own directory.

For every session it writes, under `~/.local/share/opencode-mirror/`:

| File | What it is | Cadence |
|---|---|---|
| `<sessionID>.snapshot.json` | `{ info, messages }` — the restorable artifact | ~1.5 s after activity, and on every prompt |
| `<sessionID>.events.jsonl` | raw append-only event journal, one JSON per line | **every event, instantly** |
| `index.json` | index (title, project, directory, message count, timestamps) | with every snapshot |
| `.git/` | local versioning of everything above | initial commit + every 5 min + manual |

Key properties:

- **Snapshots are written atomically** (`tmp` + `rename`), so a snapshot is never half-written.
- **Everything is wrapped in `try/catch`**: if the mirror fails for any reason, your session is
  unaffected.
- The mirror lives in `~/.local/share/opencode-mirror/` (mode `0700`), **outside** OpenCode's data
  directory, so recreating `opencode.db` does not touch it.

---

## CLI: `opencode-mirror`

```bash
opencode-mirror list                 # mirrored sessions (id, msgs, date, size, title)
opencode-mirror status               # summary + last git commit
opencode-mirror verify [<id>]        # validate snapshot structure (info + messages)
opencode-mirror log <id> [-n N]      # tail the event journal of a session
opencode-mirror git-log [-n N]       # commit history of the mirror
opencode-mirror commit               # force a git checkpoint now
opencode-mirror restore <id> [opts]  # re-import one session
opencode-mirror restore-all [opts]   # re-import every mirrored session
```

`restore` / `restore-all` options:

| Option | Meaning |
|---|---|
| `--new-ids` | Generate fresh IDs (session **and** messages). **Required if the original session still exists**, otherwise message IDs collide. |
| `--dir DIR` | Target directory for the import (default: the original directory from the snapshot). |
| `--dry-run` | Show what would be done; import nothing. |

---

## `/mirror` command (TUI)

Inside OpenCode:

```
/mirror status
/mirror list
/mirror verify
/mirror git-log
/mirror restore ses_xxx --new-ids
```

It runs the CLI and posts the output as a message in the current session.

---

## Monitoring

```bash
opencode-mirror status                  # sessions, size, last flush, last commit
opencode-mirror list                    # what is backed up
opencode-mirror log <id> -n 30          # what is being written right now
opencode-mirror verify                  # integrity check of every snapshot
opencode-mirror git-log                 # checkpoint history
```

Live file view:

```bash
ls -la ~/.local/share/opencode-mirror/
tail -f ~/.local/share/opencode-mirror/<sessionID>.events.jsonl
```

---

## Restoring

### Disaster recovery (database wiped)

```bash
opencode-mirror list
opencode-mirror restore ses_xxxxxxxxxxxxxxxxxxxxxxxxxx   # keeps the original session ID
opencode -s ses_xxxxxxxxxxxxxxxxxxxxxxxxxx               # resume it
```

Because `opencode session import` **preserves the session ID**, the restored session keeps its
original `ses_...` identifier and can be resumed with `opencode -s <id>`.

### Restoring a copy while the original still exists

```bash
opencode-mirror restore ses_xxxxxxxxxxxxxxxxxxxxxxxxxx --new-ids
```

This remaps the session ID and all message IDs so the import cannot collide with the live session.

### Everything at once

```bash
opencode-mirror restore-all
```

---

## Local git versioning

The mirror is a git repository. The plugin commits automatically:

- an initial commit ~30 s after startup,
- every 5 minutes,
- plus whenever you run `opencode-mirror commit`.

```bash
opencode-mirror git-log
git -C ~/.local/share/opencode-mirror log --oneline
git -C ~/.local/share/opencode-mirror diff HEAD~1 --stat
```

This gives you history and point-in-time recovery of the mirror itself, without cron.

---

## Configuration notes

- The plugin is **auto-discovered** from `~/.config/opencode/plugins/`. You do not need to list it
  in `opencode.jsonc`.
- The runtime does **not** resolve `@opencode/plugin` for local plugins, so `session-mirror.ts`
  exports a plain `{ id, setup }` object (equivalent to `Plugin.define`) and has no imports beyond
  Node built-ins.
- See `examples/opencode.jsonc` for a minimal V2 config reference.

---

## Privacy

- This repository contains **code only**. It never uploads your sessions or prompts.
- The mirror stays on your machine (`~/.local/share/opencode-mirror/`, mode `0700`).
- There is no network access anywhere in the plugin or the CLI.

---

## Troubleshooting

**The plugin does not load.**
Check the OpenCode log:

```bash
grep session-mirror ~/.local/share/opencode/log/opencode.log | tail
```

You should see `loading plugin ... session-mirror.ts`. If you see `failed to load plugin`, the file
was copied incorrectly.

**Nothing appears in the mirror.**
Sessions are mirrored while their project is loaded and active. Do something in a session, then:

```bash
opencode-mirror status
ls -la ~/.local/share/opencode-mirror/
```

**`opencode-mirror: command not found`.**
`~/.local/bin` is not in your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"     # add to ~/.bashrc or ~/.zshrc
```

**`restore` fails with "Session already exists".**
The session is still in the database. Use `--new-ids` to import it as a copy.

**`restore` fails with an internal error about message IDs.**
Same cause: use `--new-ids`.

---

## Limitations

- The mirror is local disk only. It protects against a wiped database, **not** against disk loss.
  Pair it with an off-disk copy (e.g. `rsync` to another drive) if you need that.
- `*.events.jsonl` includes streaming deltas, so it grows quickly. The **snapshot** is the
  restorable artifact; the journal is for forensics.

---

## License

MIT — see [LICENSE](LICENSE).
