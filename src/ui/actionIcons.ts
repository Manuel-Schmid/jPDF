import BringToFront from '@lucide/svelte/icons/bring-to-front'
import ChevronDown from '@lucide/svelte/icons/chevron-down'
import ChevronUp from '@lucide/svelte/icons/chevron-up'
import Copy from '@lucide/svelte/icons/copy'
import FilePlus from '@lucide/svelte/icons/file-plus'
import ImagePlus from '@lucide/svelte/icons/image-plus'
import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
import RotateCw from '@lucide/svelte/icons/rotate-cw'
import SendToBack from '@lucide/svelte/icons/send-to-back'
import Stamp from '@lucide/svelte/icons/stamp'
import Trash2 from '@lucide/svelte/icons/trash-2'

/**
 * One icon per kind of action, wherever it is offered (page menu, selection
 * bar, Document Builder, toolbar menu): the same action always looks the same.
 */
export const actionIcons = {
  duplicate: Copy,
  delete: Trash2,
  rotateRight: RotateCw,
  rotateLeft: RotateCcw,
  flatten: Stamp,
  insertImage: ImagePlus,
  insertPage: FilePlus,
  bringToFront: BringToFront,
  bringForward: ChevronUp,
  sendBackward: ChevronDown,
  sendToBack: SendToBack,
}
