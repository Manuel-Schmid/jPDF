import { describe, expect, it } from 'vitest'
import { selectedPageText } from '../../../src/core/viewer/pageSelection'

/** Selects all text of `el` and returns the selection. */
function select(el: Element): Selection {
  const s = window.getSelection()!
  s.removeAllRanges()
  const r = document.createRange()
  r.selectNodeContents(el)
  s.addRange(r)
  return s
}

describe('selectedPageText', () => {
  it("takes text selected on a page's text layer, with whitespace collapsed", () => {
    document.body.innerHTML = '<div class="textLayer"><span>E =\n  mc</span><span>^2</span></div><textarea>x</textarea>'
    expect(selectedPageText(select(document.querySelector('.textLayer span')!))).toBe('E = mc')
  })

  it('ignores a selection elsewhere in the app, and an empty one', () => {
    document.body.innerHTML = '<div class="field"><p>my notes</p></div>'
    expect(selectedPageText(select(document.querySelector('p')!))).toBe('')
    window.getSelection()!.removeAllRanges()
    expect(selectedPageText(window.getSelection())).toBe('')
  })
})
