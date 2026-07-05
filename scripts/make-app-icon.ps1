# Regenerates packaging/document-graph-explorer.ico from the app's icon.svg.
# Windows-only (uses GDI+); run when the brand icon changes. The generated
# .ico is committed so the desktop-shortcut installer needs no image tooling.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-app-icon.ps1
#
# Faithfully reproduces public/icon.svg (a small node-graph glyph) at 256x256:
# dark rounded tile, purple radial glow, three nodes, connecting edges.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $repoRoot 'packaging'
$outIco = Join-Path $outDir 'document-graph-explorer.ico'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$size = 256
$s = $size / 32.0  # svg viewBox is 32x32

$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded background tile: <rect width=32 height=32 rx=7 fill=#050510>
$radius = [int](7 * $s)
$rect = New-Object System.Drawing.Rectangle(0, 0, ($size - 1), ($size - 1))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
$path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
$path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
$path.CloseFigure()
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 5, 5, 16))
$g.FillPath($bg, $path)

# Radial glow: <circle cx=16 cy=16 r=11 fill=url(#g) opacity=0.9>
$cx = 16 * $s; $cy = 16 * $s; $cr = 11 * $s
$circle = New-Object System.Drawing.Drawing2D.GraphicsPath
$circle.AddEllipse(($cx - $cr), ($cy - $cr), (2 * $cr), (2 * $cr))
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($circle)
$pgb.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
$blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
$a = 230  # opacity 0.9
$blend.Colors = @(
  [System.Drawing.Color]::FromArgb($a, 10, 10, 30),    # edge   (pos 0) #0a0a1e
  [System.Drawing.Color]::FromArgb($a, 124, 92, 255),  # mid    (pos .45) #7c5cff
  [System.Drawing.Color]::FromArgb($a, 196, 181, 253)  # center (pos 1) #c4b5fd
)
$blend.Positions = @(0.0, 0.45, 1.0)
$pgb.InterpolationColors = $blend
$g.FillEllipse($pgb, ($cx - $cr), ($cy - $cr), (2 * $cr), (2 * $cr))

# Edges: <path d="M10 12 L21 10 L22 21 Z" stroke=#cfc6ff width=0.7 opacity=0.8>
$p1 = New-Object System.Drawing.PointF((10 * $s), (12 * $s))
$p2 = New-Object System.Drawing.PointF((21 * $s), (10 * $s))
$p3 = New-Object System.Drawing.PointF((22 * $s), (21 * $s))
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(204, 207, 198, 255), (0.7 * $s))
$g.DrawPolygon($pen, @($p1, $p2, $p3))

# Nodes: three dots
function Add-Dot($cxu, $cyu, $ru, $color) {
  $r = $ru * $s
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($color)), (($cxu * $s) - $r), (($cyu * $s) - $r), (2 * $r), (2 * $r))
}
Add-Dot 10 12 1.6 ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
Add-Dot 21 10 1.1 ([System.Drawing.Color]::FromArgb(255, 232, 227, 255))
Add-Dot 22 21 1.4 ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))

$g.Dispose()

# Encode the bitmap as PNG in memory, then wrap it in a single-image ICO
# container (Vista+ PNG-compressed frame — supported by Explorer/shortcuts).
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ms.Dispose(); $bmp.Dispose()

$fs = [System.IO.File]::Create($outIco)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR
$bw.Write([UInt16]0)   # reserved
$bw.Write([UInt16]1)   # type = icon
$bw.Write([UInt16]1)   # image count
# ICONDIRENTRY
$bw.Write([Byte]0)     # width  (0 => 256)
$bw.Write([Byte]0)     # height (0 => 256)
$bw.Write([Byte]0)     # palette
$bw.Write([Byte]0)     # reserved
$bw.Write([UInt16]1)   # color planes
$bw.Write([UInt16]32)  # bits per pixel
$bw.Write([UInt32]$png.Length)  # bytes of image data
$bw.Write([UInt32]22)  # offset (6 + 16)
$bw.Write($png)
$bw.Flush(); $bw.Dispose(); $fs.Dispose()

Write-Host "Wrote $outIco ($($png.Length) bytes PNG frame)"
