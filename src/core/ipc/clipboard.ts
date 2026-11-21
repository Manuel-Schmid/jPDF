import { readImage, readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { RgbaImage } from '../../annotations/image/encode'

/** An image on the system clipboard: unpremultiplied 8-bit RGBA pixels. */
export type ClipboardImage = RgbaImage

/**
 * How the plugin rejects when the clipboard holds no image: the text of
 * arboard's `Error::ContentNotAvailable` (arboard 3.x, forwarded as is by
 * tauri-plugin-clipboard-manager).
 */
const NO_IMAGE = 'The clipboard contents were not available in the requested format or the clipboard is empty.'

/** The image on the clipboard; null when there is none or it cannot be read (logged). */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  let image: Awaited<ReturnType<typeof readImage>> | null = null
  try {
    image = await readImage()
    const { width, height } = await image.size()
    const rgba = await image.rgba()
    if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) return null
    return { width, height, rgba }
  } catch (e) {
    if (String(e).trim() !== NO_IMAGE) console.error('Could not read the clipboard image', e)
    return null
  } finally {
    image?.close().catch(() => {})
  }
}

/** Puts `text` on the clipboard (rejects when it cannot be written). */
export function writeClipboardText(text: string): Promise<void> {
  return writeText(text)
}

/** The text on the clipboard; null when there is none or it cannot be read. */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await readText()
  } catch {
    return null
  }
}
