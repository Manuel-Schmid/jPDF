# Generates the NSIS installer banners in src-tauri/icons/ from icon.png:
#   installer-sidebar.bmp  164x314  Welcome and Finish pages
#   installer-header.bmp   150x57   inner wizard pages
# Both use the app's dark background (--bg, --accent and --text-strong in
# src/theme/tokens.css) with the logo and the "JuliePDF" wordmark. NSIS needs
# uncompressed 24-bit BMPs, which System.Drawing writes by default.
# Run from the repo root after changing the icon:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installerImages.ps1

Add-Type -AssemblyName System.Drawing

$icons = Join-Path $PSScriptRoot '..\src-tauri\icons' | Resolve-Path
$logo = [System.Drawing.Image]::FromFile((Join-Path $icons 'icon.png'))

$bg = [System.Drawing.ColorTranslator]::FromHtml('#0f111a')
$bgDeep = [System.Drawing.ColorTranslator]::FromHtml('#090b10')
$text = [System.Drawing.ColorTranslator]::FromHtml('#eeffff')
$accent = [System.Drawing.ColorTranslator]::FromHtml('#ffc107')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#8f93a2')

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  # Plain anti-aliasing: ClearType fringes look wrong once baked into a bitmap.
  $g.TextRenderingHint = 'AntiAliasGridFit'
  return $bmp, $g
}

# Draws "Julie" in the strong text colour and "PDF" in the accent colour,
# centred on $cx (or left-aligned at $x when $cx is $null), top at $y.
function Draw-Wordmark($g, [string]$family, [float]$size, $cx, [float]$x, [float]$y) {
  $font = New-Object System.Drawing.Font $family, $size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = [System.Drawing.StringFormat]::GenericTypographic
  $w1 = $g.MeasureString('Julie', $font, 1000, $fmt).Width
  $w2 = $g.MeasureString('PDF', $font, 1000, $fmt).Width
  if ($null -ne $cx) { $x = $cx - ($w1 + $w2) / 2 }
  $g.DrawString('Julie', $font, (New-Object System.Drawing.SolidBrush $text), $x, $y, $fmt)
  $g.DrawString('PDF', $font, (New-Object System.Drawing.SolidBrush $accent), $x + $w1, $y, $fmt)
  $font.Dispose()
}

# Sidebar: subtle vertical gradient, logo and wordmark in the upper part so
# they stay clear of the page's own text on the right.
$bmp, $g = New-Canvas 164 314
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, 314), $bg, $bgDeep
$g.FillRectangle($grad, 0, 0, 164, 314)
$g.DrawImage($logo, 34, 56, 96, 96)
Draw-Wordmark $g 'Segoe UI' 26 82 0 168
$tag = New-Object System.Drawing.Font 'Segoe UI', 11, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$g.DrawString('Lightweight PDF annotator', $tag, (New-Object System.Drawing.SolidBrush $muted), (New-Object System.Drawing.RectangleF 0, 204, 164, 16), $fmt)
# Accent rule along the right edge, where the sidebar meets the white page.
$g.FillRectangle((New-Object System.Drawing.SolidBrush $accent), 161, 0, 3, 314)
$g.Dispose()
$bmp.Save((Join-Path $icons 'installer-sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# Header: logo on the left, wordmark beside it.
$bmp, $g = New-Canvas 150 57
$g.Clear($bg)
$g.DrawImage($logo, 9, 10, 37, 37)
Draw-Wordmark $g 'Segoe UI' 20 $null 54 15
$g.FillRectangle((New-Object System.Drawing.SolidBrush $accent), 0, 54, 150, 3)
$g.Dispose()
$bmp.Save((Join-Path $icons 'installer-header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

$logo.Dispose()
