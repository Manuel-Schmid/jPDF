import type { Component } from 'svelte'
import type { TextLineAnnotation } from '../../core/session/model'
import { newId } from '../../core/session/model'
import type { ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import { toasts } from '../../ui/toasts.svelte'
import { listenForTextSelection, markupFromSelection, textMarkupCommand, type Ranges } from '../shared/textMarkup'
import { listenForUnmark } from '../shared/unmark'
import Options from './Options.svelte'
import StrikeoutIcon from './StrikeoutIcon.svelte'
import UnderlineIcon from './UnderlineIcon.svelte'
import type { TextLineSettings } from './settings'

export type { TextLineSettings }

export const NO_TEXT_HINT = 'textLineNoText'
export const NO_TEXT_MESSAGE = 'No selectable text on this page — underline and strikethrough need text'

type Kind = TextLineAnnotation['kind']

/**
 * Underline / strike-out: select text natively. While the selection is
 * dragged out the lines themselves are previewed (the selection is not
 * drawn); on release they become one annotation per page, merged into
 * touching ones of the same kind and colour. A right-button drag unmarks
 * instead (see unmark.ts). Pages without text only get a one-time hint.
 */
export function createTextLineHandler(kind: Kind, ctx: ToolContext, settings: () => TextLineSettings): ToolHandler {
  function build(sel: Ranges, id: (page: number) => string): TextLineAnnotation[] {
    const { color } = settings()
    const modifiedAt = new Date().toISOString()
    return markupFromSelection(sel, (page, quads) => ({
      id: id(page),
      page,
      sourceRef: null,
      modifiedAt,
      author: appSettings.data.author,
      kind,
      quads,
      color,
    }))
  }
  const stop = listenForTextSelection(
    (sel) => {
      const lines = build(sel, () => newId())
      if (lines.length === 0) return false
      ctx.execute(textMarkupCommand(ctx.session.store, lines))
      return true
    },
    (sel) => ctx.pagePreviews?.set(sel ? build(sel, (page) => `preview-${page}`) : []),
  )
  // Right-button drag: unmark this kind of line from the dragged-over text.
  const stopUnmark = listenForUnmark(ctx, () => kind)
  return {
    textSelection: () => ({ color: null }),
    onPointerDown() {
      if (appSettings.data.hints[NO_TEXT_HINT]) return
      toasts.show(NO_TEXT_MESSAGE)
      appSettings.setHint(NO_TEXT_HINT)
    },
    onDeactivate() {
      stop()
      stopUnmark()
    },
  }
}

function textLineTool(
  kind: Kind,
  meta: Pick<ToolDefinition, 'displayName' | 'description' | 'shortcut'>,
  Icon: Component<{ settings: TextLineSettings; size: number }>,
  color: TextLineSettings['color'],
): ToolDefinition<TextLineSettings> {
  return {
    type: kind,
    ...meta,
    Icon,
    defaultSettings: { color },
    Options,
    cursor: () => 'text',
    defaultLocked: true,
    allowMultipleInstances: true,
    createHandler: (ctx, settings) => createTextLineHandler(kind, ctx, settings),
  }
}

export const underlineTool = textLineTool(
  'underline',
  { displayName: 'Underline', description: 'Underline text', shortcut: 'U' },
  UnderlineIcon,
  [0.118, 0.533, 0.898],
)

export const strikeoutTool = textLineTool(
  'strikeout',
  { displayName: 'Strikethrough', description: 'Strike through text', shortcut: 'K' },
  StrikeoutIcon,
  [0.898, 0.224, 0.208],
)
