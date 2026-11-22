import type { RGB } from '../../core/session/model'

export interface MarkerSettings {
  mode: 'text' | 'freehand'
  color: RGB
  opacity: number
  width: number
  /** Freehand: holding still mid-stroke straightens it (absent in older saved settings: on). */
  holdStraight: boolean
}

export const MARKER_PRESETS: RGB[] = [
  [1, 0.922, 0.231], // #FFEB3B
  [0.463, 1, 0.012], // #76FF03
  [0.094, 1, 1], // #18FFFF
  [1, 0.251, 0.506], // #FF4081
  [1, 0.671, 0.251], // #FFAB40
  [0.702, 0.533, 1], // #B388FF
]
