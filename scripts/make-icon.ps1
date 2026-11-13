# Generates build/icon.png (512px) and build/icon.ico (256px) from scratch.
# Kept as a script so the icon can be regenerated or restyled later.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function New-AppBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 512.0

  # rounded square background with a vertical gradient
  $radius = 112 * $s
  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bg.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
  $bg.AddArc($size - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
  $bg.AddArc($size - $radius * 2, $size - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $bg.AddArc(0, $size - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $bg.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $size)),
    ([System.Drawing.Color]::FromArgb(255, 124, 168, 255)),
    ([System.Drawing.Color]::FromArgb(255, 59, 96, 214))
  )
  $g.FillPath($brush, $bg)
  $brush.Dispose()

  # soft highlight
  $glow = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, [int]($size * 0.55))),
    ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)),
    ([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  )
  $g.FillRectangle($glow, 0, 0, $size, [int]($size * 0.55))
  $glow.Dispose()

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

  # mortarboard top (diamond)
  $top = @(
    (New-Object System.Drawing.PointF ([int](256 * $s), [int](150 * $s))),
    (New-Object System.Drawing.PointF ([int](420 * $s), [int](224 * $s))),
    (New-Object System.Drawing.PointF ([int](256 * $s), [int](298 * $s))),
    (New-Object System.Drawing.PointF ([int](92 * $s), [int](224 * $s)))
  )
  $g.FillPolygon($white, $top)

  # cap body (trapezoid hanging below)
  $body = @(
    (New-Object System.Drawing.PointF ([int](186 * $s), [int](268 * $s))),
    (New-Object System.Drawing.PointF ([int](326 * $s), [int](268 * $s))),
    (New-Object System.Drawing.PointF ([int](318 * $s), [int](330 * $s))),
    (New-Object System.Drawing.PointF ([int](256 * $s), [int](366 * $s))),
    (New-Object System.Drawing.PointF ([int](194 * $s), [int](330 * $s)))
  )
  $g.FillPolygon($white, $body)

  # tassel
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([int](14 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, [int](408 * $s), [int](236 * $s), [int](420 * $s), [int](330 * $s))
  $g.FillEllipse($white, [int](404 * $s), [int](326 * $s), [int](32 * $s), [int](32 * $s))
  $pen.Dispose()
  $white.Dispose()

  $g.Dispose()
  return $bmp
}

# --- PNG (window icon) ---
$png512 = New-AppBitmap 512
$png512.Save((Join-Path $buildDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# --- ICO (installer) : header + directory entry + embedded PNG ---
$ico256 = New-AppBitmap 256
$ms = New-Object System.IO.MemoryStream
$ico256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ico256.Dispose()
$ms.Dispose()

$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Create((Join-Path $buildDir 'icon.ico')))
$writer.Write([UInt16]0)        # reserved
$writer.Write([UInt16]1)        # type: icon
$writer.Write([UInt16]1)        # image count
$writer.Write([Byte]0)          # width  (0 = 256)
$writer.Write([Byte]0)          # height (0 = 256)
$writer.Write([Byte]0)          # palette
$writer.Write([Byte]0)          # reserved
$writer.Write([UInt16]1)        # colour planes
$writer.Write([UInt16]32)       # bits per pixel
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)       # offset of image data
$writer.Write($pngBytes)
$writer.Dispose()

$png512.Dispose()
Write-Output "icon.png  $((Get-Item (Join-Path $buildDir 'icon.png')).Length) bytes"
Write-Output "icon.ico  $((Get-Item (Join-Path $buildDir 'icon.ico')).Length) bytes"