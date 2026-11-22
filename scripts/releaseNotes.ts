/**
 * Release notes for a version tag: the user-facing commit subjects on main
 * since the previous tag, as a plain list. The release workflow passes them
 * to tauri-action as the release body, which also becomes `notes` in
 * latest.json and so the text of the in-app update prompt (plain text, not
 * Markdown).
 *
 * Usage: node scripts/releaseNotes.ts v1.2.3
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Conventional-commit types that never matter to users. */
const INTERNAL = new Set(['chore', 'docs', 'test', 'tests', 'ci', 'build', 'refactor', 'style'])

/** Shown when a release has no user-facing change. */
export const NO_CHANGES = 'Maintenance and internal improvements.'

/**
 * "feat: copy annotations (#46)" → "Copy annotations"; null for internal
 * commits (chore:, docs: …). Subjects without a type are kept as they are:
 * a squash merge may use the PR title, which needn't have one.
 */
export function noteFor(subject: string): string | null {
  const m = /^(\w+)(\([^)]*\))?!?:\s*(.*)$/.exec(subject.trim())
  if (m && INTERNAL.has(m[1].toLowerCase())) return null
  const text = (m ? m[3] : subject).replace(/\s*\(#\d+\)\s*$/, '').trim()
  if (!text) return null
  return text[0].toUpperCase() + text.slice(1)
}

/** One "• " line per user-facing subject, oldest first (git log lists newest first). */
export function releaseNotes(subjects: string[]): string {
  const lines = subjects
    .map(noteFor)
    .filter((n): n is string => n !== null)
    .reverse()
    .map((n) => `• ${n}`)
  return lines.length > 0 ? lines.join('\n') : NO_CHANGES
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const tag = process.argv[2]
  if (!tag) throw new Error('Usage: node scripts/releaseNotes.ts <tag>')
  // The first release has no previous tag: take the whole history.
  let range = tag
  try {
    range = `${git('describe', '--tags', '--abbrev=0', `${tag}^`)}..${tag}`
  } catch {}
  const subjects = git('log', '--format=%s', range).split('\n').filter(Boolean)
  process.stdout.write(releaseNotes(subjects) + '\n')
}
