// @ts-nocheck
/**
 * session-mirror — real-time backup of OpenCode V2 sessions.
 *
 * For every session it writes, under ~/.local/share/opencode-mirror/ :
 *   <sessionID>.snapshot.json  -> { info, messages }  (export/import shape, restorable)
 *   <sessionID>.events.jsonl   -> raw append-only event journal, one event per line
 *   index.json                 -> session index (title, project, dir, message count, dates)
 * and versions everything with a local git repo (coalesced commits, no cron).
 *
 * Note: the runtime does NOT resolve `@opencode/plugin` for local plugins, so this file
 * exports a plain { id, setup } object (equivalent to Plugin.define).
 */
import {
  promises as fs,
  appendFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawn, execFileSync } from "node:child_process"

const ROOT = join(homedir(), ".local", "share", "opencode-mirror")
const FLUSH_MS = 1500
const GIT_MS = 5 * 60 * 1000

function sid(ev) {
  return ev?.data?.sessionID ?? ev?.durable?.aggregateID ?? ev?.sessionID ?? undefined
}

function readIndex() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"))
  } catch {
    return {}
  }
}

function writeIndexAtomic(obj) {
  const tmp = join(ROOT, ".index.tmp")
  writeFileSync(tmp, JSON.stringify(obj, null, 2))
  renameSync(tmp, join(ROOT, "index.json"))
}

function git(args) {
  return new Promise((resolve) => {
    try {
      const p = spawn("git", ["-C", ROOT, ...args], { stdio: "ignore" })
      p.on("error", () => resolve(false))
      p.on("close", (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

async function ensureGit() {
  if (!existsSync(join(ROOT, ".git"))) {
    await git(["init", "-q"])
    await git(["config", "user.email", "session-mirror@localhost"])
    await git(["config", "user.name", "session-mirror"])
  }
  const gi = join(ROOT, ".gitignore")
  if (!existsSync(gi)) {
    try {
      appendFileSync(gi, ".index.tmp\n.*.tmp\n*.lock\n")
    } catch {}
  }
}

const plugin = {
  id: "session-mirror",
  async setup(ctx) {
    mkdirSync(ROOT, { recursive: true, mode: 0o700 })
    await ensureGit()

    const myDir = ctx?.location?.directory
    const timers = new Map()
    const dirty = new Set()
    let gitTimer = null

    const flush = async (sessionID) => {
      try {
        const info = await ctx.session.get({ sessionID })
        const messages = await ctx.session.context({ sessionID })
        const data = { info, messages }
        const tmp = join(ROOT, `.${sessionID}.tmp`)
        await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
        await fs.rename(tmp, join(ROOT, `${sessionID}.snapshot.json`))
        const idx = readIndex()
        idx[sessionID] = {
          id: sessionID,
          title: info?.title ?? idx[sessionID]?.title ?? null,
          projectID: info?.projectID ?? null,
          parentID: info?.parentID ?? null,
          directory: info?.location?.directory ?? myDir ?? null,
          messages: Array.isArray(messages) ? messages.length : 0,
          created: info?.time?.created ?? null,
          updated: Date.now(),
        }
        writeIndexAtomic(idx)
      } catch {
        /* session deleted or transient: ignore */
      }
    }

    const schedule = (sessionID) => {
      dirty.add(sessionID)
      if (timers.has(sessionID)) return
      timers.set(
        sessionID,
        setTimeout(() => {
          timers.delete(sessionID)
          dirty.delete(sessionID)
          void flush(sessionID)
        }, FLUSH_MS),
      )
    }

    const journal = (sessionID, ev) => {
      try {
        appendFileSync(join(ROOT, `${sessionID}.events.jsonl`), JSON.stringify(ev) + "\n")
      } catch {}
    }

    // 1) live event stream
    const ac = new AbortController()
    void (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ signal: ac.signal })) {
          const loc = ev?.location?.directory
          // each location has its own instance; process only events from ours
          if (loc && myDir && loc !== myDir) continue
          const s = sid(ev)
          if (!s) continue
          journal(s, ev)
          schedule(s)
        }
      } catch {
        /* stream closed */
      }
    })()

    // 2) accepted prompt -> immediate flush (capture the text right away)
    try {
      await ctx.session.hook("prompt", (event) => {
        const s = event?.sessionID ?? event?.data?.sessionID
        if (s) {
          journal(s, { type: "mirror.prompt", created: Date.now(), data: { sessionID: s, prompt: event?.prompt } })
          void flush(s)
        }
      })
    } catch {}

    // 3) local git: coalesced commits (no cron)
    const commit = async () => {
      await git(["add", "-A"])
      await git(["commit", "-q", "-m", `mirror ${new Date().toISOString()}`])
    }
    const initial = setTimeout(() => void commit(), 30 * 1000)
    gitTimer = setInterval(() => void commit(), GIT_MS)

    // 4) /mirror command in the TUI
    try {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "mirror",
          description: "Session backup: /mirror list | status | verify | git-log | restore <id>",
          async execute({ sessionID, prompt }) {
            const text = String(prompt?.text ?? prompt?.arguments ?? "list").trim() || "list"
            let out = ""
            try {
              out = execFileSync(join(homedir(), ".local", "bin", "opencode-mirror"),
                text.split(/\s+/).filter(Boolean), { encoding: "utf8", timeout: 180000 })
            } catch (e) {
              out = "opencode-mirror error:\n" + (e?.stdout || e?.message || String(e))
            }
            try {
              await ctx.session.synthetic({ sessionID, text: "```\n" + out.trim() + "\n```" })
            } catch {}
          },
        })
      })
    } catch {}

    return () => {
      try {
        ac.abort()
      } catch {}
      if (gitTimer) clearInterval(gitTimer)
      clearTimeout(initial)
      for (const t of timers.values()) clearTimeout(t)
    }
  },
}

export default plugin
