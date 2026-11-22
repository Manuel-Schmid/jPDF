import type { RGB } from '../../core/session/model'

export interface PenSettings {
  color: RGB
  width: number
  opacity: number
  /** Holding the pen still mid-stroke straightens it (absent in older saved settings: on). */
  holdStraight: boolean
}

export const PEN_PRESETS: RGB[] = [
  [0, 0, 0], // #000000
  [0.898, 0.224, 0.208], // #E53935
  [0.118, 0.533, 0.898], // #1E88E5
  [0.263, 0.627, 0.278], // #43A047
  [1, 0.757, 0.027], // #FFC107
  [1, 1, 1], // #FFFFFF
]
