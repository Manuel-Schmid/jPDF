import { describe, expect, it } from 'vitest'
import { NO_CHANGES, noteFor, releaseNotes } from '../../scripts/releaseNotes'

describe('noteFor', () => {
  it('strips the type, scope and PR number and capitalises', () => {
    expect(noteFor('feat: copy, cut and paste annotations (#46)')).toBe('Copy, cut and paste annotations')
    expect(noteFor('fix(viewer): blank page after zoom (#12)')).toBe('Blank page after zoom')
    expect(noteFor('perf!: faster thumbnails')).toBe('Faster thumbnails')
  })

  it('drops internal commits', () => {
    for (const s of ['chore: version 1.0.5 (#57)', 'docs: release notes (#54)', 'test: more cases', 'ci: cache', 'refactor(core): split'])
      expect(noteFor(s)).toBeNull()
  })

  it('keeps a subject without a type as it is', () => {
    expect(noteFor('Reworked settings dialog with categories (#56)')).toBe('Reworked settings dialog with categories')
  })
})

describe('releaseNotes', () => {
  it('lists the user-facing changes oldest first, one per line', () => {
    // git log order: newest first.
    const subjects = [
      'chore: version 1.0.5 (#57)',
      'feat: rework the settings dialog into categories (#56)',
      'docs: release and auto-update notes for agents (#54)',
      'fix: crash on empty file (#53)',
    ]
    expect(releaseNotes(subjects)).toBe('• Crash on empty file\n• Rework the settings dialog into categories')
  })

  it('says so when nothing user-facing changed', () => {
    expect(releaseNotes(['chore: version 1.0.6 (#60)'])).toBe(NO_CHANGES)
    expect(releaseNotes([])).toBe(NO_CHANGES)
  })
})
