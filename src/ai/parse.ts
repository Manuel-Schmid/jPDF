/**
 * Reading the model's streamed answer: one JSON object per line,
 * `{ "page": 3, "text": "…" }`. Models are not always tidy, so a line may
 * come in a code fence, with a trailing comma, inside an array bracket or as
 * a broken fragment; anything that is not a usable object is skipped.
 */

export interface ParsedLine {
  page: number
  text: string
}

/** The explanation in one answer line, or null when the line carries none. */
export function parseAnswerLine(line: string): ParsedLine | null {
  let t = line.trim()
  if (t.startsWith('```')) return null
  // A JSON array spread over lines: "[{…}," / "{…}]".
  t = t.replace(/^\[\s*/, '').replace(/\s*\]$/, '').replace(/,\s*$/, '')
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  let v: unknown
  try {
    v = JSON.parse(t)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const page = typeof o.page === 'string' ? Number(o.page) : o.page
  const text = typeof o.text === 'string' ? o.text.trim() : null
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || !text) return null
  return { page, text }
}
