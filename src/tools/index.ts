import { toolRegistry } from '../core/registry/tools'
import { eraserTool } from './eraser'
import { lassoTool } from './lasso'
import { markerTool } from './marker'
import { penTool } from './pen'
import { selectTool } from './select'
import { shapeTool } from './shape'
import { textTool } from './text'
import { strikeoutTool, underlineTool } from './textline'

// First: the default tool, listed first in the tool picker.
toolRegistry.register(selectTool)
toolRegistry.register(lassoTool)
toolRegistry.register(penTool)
toolRegistry.register(eraserTool)
toolRegistry.register(markerTool)
toolRegistry.register(underlineTool)
toolRegistry.register(strikeoutTool)
toolRegistry.register(textTool)
toolRegistry.register(shapeTool)
