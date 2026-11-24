/**
 * The generate button: "Add explanations" while no page has one; once any
 * page has one it regenerates, which overwrites them (hand edits included),
 * so the user is asked first.
 */
export interface GenerationAction {
  label: string
  /** The question to confirm first, or null to start right away. */
  confirm: string | null
}

export function generationAction(hasAnyExplanation: boolean): GenerationAction {
  if (!hasAnyExplanation) return { label: 'Add explanations', confirm: null }
  return {
    label: 'Regenerate explanations',
    confirm: 'Regenerating replaces the existing explanations of all pages, including ones you edited by hand.',
  }
}
