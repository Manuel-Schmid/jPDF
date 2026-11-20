import type { ClipboardImage } from '../core/ipc/clipboard'
import { flattenAnnotations, Z_ORDER_LABELS, type ZOrder } from '../core/session/commands'
import type { History } from '../core/session/history.svelte'
import { isEditable, type Annotation } from '../core/session/model'
import type { AnnotationStore } from '../core/session/store.svelte'
import { actionIcons } from '../ui/actionIcons'
import type { MenuItem } from '../ui/ContextMenu.svelte'
import { toasts } from '../ui/toasts.svelte'

/** The page operations of a document (DocumentSession); pages are 0-based. */
export interface PageMenuActions {
  duplicatePage(i: number): void
  deletePage(i: number): void
  insertBlankPage(i: number): Promise<void>
  rotatePage(i: number, delta: 90 | -90): Promise<void>
  canDeletePage(): boolean
}

/** Pasting the clipboard image onto the page ("Insert image"). */
export interface PageMenuPaste {
  /** The clipboard image read when the menu opened; null while unknown or when there is none. */
  image: ClipboardImage | null
  insert(image: ClipboardImage): void | Promise<void>
}

/** Flattening annotations of the page into its content (on the next save). */
export interface PageMenuFlatten {
  /** Selected annotations on the page; the "Flatten selection" item shows only when > 0. */
  selected: number
  /** Editable annotations on the page; "Flatten all" is disabled without any. */
  onPage: number
  flattenSelection(): void | Promise<void>
  flattenPage(): void | Promise<void>
}

/**
 * Flattening for the page menu of `page` (1-based): the selected and all
 * editable annotations on that page, each flattened as one undo step (the
 * selection then drops them, see ToolRouter.pruneSelection).
 */
export function pageFlatten(
  session: { store: AnnotationStore; history: History },
  selection: readonly string[],
  page: number,
): PageMenuFlatten {
  const onPage = session.store.byPage(page - 1).filter(isEditable)
  const ids = new Set(selection)
  const selected = onPage.filter((a) => ids.has(a.id))
  const run = (list: Annotation[]) => {
    if (list.length > 0) session.history.execute(flattenAnnotations(list))
  }
  return {
    selected: selected.length,
    onPage: onPage.length,
    flattenSelection: () => run(selected),
    flattenPage: () => run(onPage),
  }
}

/** The selection that was right-clicked: its actions head the menu. */
export interface PageMenuSelection {
  /** Number of selected annotations. */
  count: number
  duplicate(): void | Promise<unknown>
  /** Changes the selection's stacking order; its item is disabled while `canRestack(how)` is false. */
  restack(how: ZOrder): void | Promise<unknown>
  canRestack(how: ZOrder): boolean
  flatten(): void | Promise<unknown>
  delete(): void | Promise<unknown>
}

const Z_ORDER_ITEMS: { how: ZOrder; icon: MenuItem['icon'] }[] = [
  { how: 'front', icon: actionIcons.bringToFront },
  { how: 'forward', icon: actionIcons.bringForward },
  { how: 'backward', icon: actionIcons.sendBackward },
  { how: 'back', icon: actionIcons.sendToBack },
]

/**
 * Items of the page context menu (right-click with select, lasso or
 * the text-selection marker) for `page` (1-based) of the document `actions`
 * belongs to. Each operation is one undo step. "Insert image" pastes the
 * clipboard image (`paste`); it is disabled while there is none. With
 * `flatten`, the selection or all annotations of the page can be flattened.
 * With `selection` (the click was on it), its actions come first, then a
 * divider, then the page actions ("Flatten selection" is then left out).
 */
export function pageMenuItems(
  page: number,
  actions: PageMenuActions,
  paste?: PageMenuPaste,
  flatten?: PageMenuFlatten,
  selection?: PageMenuSelection,
): MenuItem[] {
  const i = page - 1
  /** Runs an operation; a failure is reported to the user, never thrown. */
  const attempt = (what: string, op: () => void | Promise<unknown>, failure = `Could not ${what} the page`) => () => {
    const fail = (e: unknown) => {
      console.error(`Could not ${what} page ${page}`, e)
      toasts.show(failure, 'error')
    }
    try {
      void Promise.resolve(op()).catch(fail)
    } catch (e) {
      fail(e)
    }
  }
  const flattenItems: MenuItem[] = !flatten
    ? []
    : [
        ...(flatten.selected > 0 && !selection
          ? [
              {
                label: 'Flatten selection',
                icon: actionIcons.flatten,
                run: attempt('flatten the selection on', flatten.flattenSelection, 'Could not flatten the selection'),
              },
            ]
          : []),
        {
          label: `Flatten all annotations on page ${page}`,
          icon: actionIcons.flatten,
          disabled: flatten.onPage === 0,
          run: attempt('flatten the annotations on', flatten.flattenPage, 'Could not flatten the annotations'),
        },
      ]
  const n = selection?.count ?? 0
  /** "Delete" for one annotation, "Delete 3 annotations" for a group. */
  const what = (verb: string) => (n > 1 ? `${verb} ${n} annotations` : verb)
  const selectionItems: MenuItem[] = !selection
    ? []
    : [
        { label: what('Duplicate'), icon: actionIcons.duplicate, run: attempt('duplicate the selection on', selection.duplicate, 'Could not duplicate') },
        ...Z_ORDER_ITEMS.map(({ how, icon }, k) => ({
          label: Z_ORDER_LABELS[how],
          icon,
          separatorBefore: k === 0,
          disabled: !selection.canRestack(how),
          run: attempt('restack the selection on', () => selection.restack(how), 'Could not change the order'),
        })),
        { label: what('Flatten'), icon: actionIcons.flatten, separatorBefore: true, run: attempt('flatten the selection on', selection.flatten, 'Could not flatten the selection') },
        { label: what('Delete'), icon: actionIcons.delete, danger: true, run: attempt('delete the selection on', selection.delete, 'Could not delete') },
      ]
  return [
    ...selectionItems,
    {
      label: 'Insert image',
      icon: actionIcons.insertImage,
      separatorBefore: selectionItems.length > 0,
      disabled: !paste?.image,
      run: attempt(
        'insert the image on',
        () => {
          if (paste?.image) return paste.insert(paste.image)
        },
        'Could not insert the image',
      ),
    },
    {
      label: `Insert empty page after page ${page}`,
      icon: actionIcons.insertPage,
      run: attempt('insert an empty page after', () => actions.insertBlankPage(i)),
    },
    { label: `Duplicate page ${page}`, icon: actionIcons.duplicate, run: attempt('duplicate', () => actions.duplicatePage(i)) },
    { label: 'Rotate right', icon: actionIcons.rotateRight, run: attempt('rotate', () => actions.rotatePage(i, 90)) },
    { label: 'Rotate left', icon: actionIcons.rotateLeft, run: attempt('rotate', () => actions.rotatePage(i, -90)) },
    ...flattenItems,
    {
      label: `Delete page ${page}`,
      icon: actionIcons.delete,
      danger: true,
      disabled: !actions.canDeletePage(),
      run: attempt('delete', () => actions.deletePage(i)),
    },
  ]
}
