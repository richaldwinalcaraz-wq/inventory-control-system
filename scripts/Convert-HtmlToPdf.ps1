<#
.SYNOPSIS
    Renders a self-contained HTML file to PDF using headless Microsoft Edge.

.DESCRIPTION
    The single Edge-rendering primitive for this project. Convert-MarkdownToPdf.ps1
    calls this after producing HTML; visual documents authored directly in HTML
    (e.g. the executive summary deck) call it on their own.

    The HTML must be self-contained — no external stylesheets, scripts, fonts, or
    images. Edge renders from a file:// URL with no network access assumed.

.PARAMETER HtmlPath
    Source .html file.

.PARAMETER PdfPath
    Destination .pdf file.

.PARAMETER TimeoutSeconds
    How long to wait for Edge to write the PDF. Default 90.

.EXAMPLE
    .\Convert-HtmlToPdf.ps1 -HtmlPath .\docs\executive-summary.html `
                            -PdfPath  .\docs\Inventory-Executive-Summary.pdf
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HtmlPath,
    [Parameter(Mandatory = $true)][string]$PdfPath,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $HtmlPath)) { throw "HTML file not found: $HtmlPath" }
$htmlFull = (Resolve-Path -LiteralPath $HtmlPath).Path
$pdfFull  = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PdfPath)

$pdfDir = Split-Path -Parent $pdfFull
if ($pdfDir -and -not (Test-Path -LiteralPath $pdfDir)) {
    New-Item -ItemType Directory -Path $pdfDir -Force | Out-Null
}

$edge = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge not found - cannot render PDF." }

if (Test-Path -LiteralPath $pdfFull) { Remove-Item -LiteralPath $pdfFull -Force }

$fileUri    = 'file:///' + ($htmlFull -replace '\\', '/')
$profileDir = Join-Path $env:TEMP ("edge-pdf-" + [guid]::NewGuid().ToString('N'))

Write-Host "Rendering: $pdfFull"
& $edge --headless --disable-gpu --no-first-run --no-default-browser-check `
        --user-data-dir="$profileDir" `
        --print-to-pdf-no-header `
        --print-to-pdf="$pdfFull" `
        "$fileUri" | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path -LiteralPath $pdfFull) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
}

try { Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction Stop } catch { }

if (-not (Test-Path -LiteralPath $pdfFull)) { throw "Edge did not produce a PDF at $pdfFull" }

$size = [math]::Round((Get-Item -LiteralPath $pdfFull).Length / 1KB, 1)
Write-Host "Done     : $pdfFull ($size KB)"
