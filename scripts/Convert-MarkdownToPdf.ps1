<#
.SYNOPSIS
    Converts a Markdown document to a print-ready, styled PDF using headless Microsoft Edge.

.DESCRIPTION
    Written for this project's docs, which use only the GitHub-flavoured Markdown that maps
    cleanly to print: headings, tables, fenced ASCII diagrams, lists, blockquotes, rules,
    and inline emphasis/code/links. Mermaid diagrams are NOT rendered — they would need an
    external library, and the documents this script targets do not use them.

    No pandoc/Node/Python dependency: Edge ships with Windows 11 and can print to PDF headlessly.

.PARAMETER MarkdownPath
    Source .md file.

.PARAMETER PdfPath
    Destination .pdf file.

.PARAMETER Title
    Title for the browser tab / PDF metadata. Defaults to the document's first H1.

.PARAMETER NoToc
    Skip the generated table of contents.

.PARAMETER KeepHtml
    Keep the intermediate .html next to the PDF for inspection.

.EXAMPLE
    .\Convert-MarkdownToPdf.ps1 -MarkdownPath ..\docs\business-process-design.md `
                                -PdfPath ..\docs\Inventory-Business-Process-Design.pdf
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MarkdownPath,
    [Parameter(Mandatory = $true)][string]$PdfPath,
    [string]$Title,
    [switch]$NoToc,
    [switch]$KeepHtml
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- helpers ----

function ConvertTo-HtmlText {
    param([string]$Text)
    $Text -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
}

function ConvertTo-InlineHtml {
    <# Applies inline Markdown to text that has ALREADY been HTML-escaped. #>
    param([string]$Text)
    $t = $Text
    $t = [regex]::Replace($t, '`([^`]+)`', '<code>$1</code>')
    $t = [regex]::Replace($t, '\*\*([^*]+)\*\*', '<strong>$1</strong>')
    $t = [regex]::Replace($t, '(?<![\*\w])\*([^*\r\n]+)\*(?![\*\w])', '<em>$1</em>')
    $t = [regex]::Replace($t, '\[([^\]]+)\]\(([^)\s]+)\)', '<a href="$2">$1</a>')
    return $t
}

function New-Slug {
    param([string]$Text)
    $s = $Text.ToLowerInvariant()
    $s = [regex]::Replace($s, '[*`\[\]()]', '')
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
    $s.Trim('-')
}

function Test-TableSeparator {
    param([string]$Line)
    if ($Line -notmatch '^\s*\|') { return $false }
    $cells = $Line.Trim().Trim('|') -split '\|'
    foreach ($c in $cells) {
        if ($c.Trim() -notmatch '^:?-{2,}:?$') { return $false }
    }
    return $true
}

function Split-TableRow {
    param([string]$Line)
    $inner = $Line.Trim()
    $inner = $inner -replace '^\|', ''
    $inner = $inner -replace '\|$', ''
    @($inner -split '\|' | ForEach-Object { $_.Trim() })
}

# ------------------------------------------------- block flushing (script scope)

function Close-Paragraph {
    if ($script:para.Count -gt 0) {
        [void]$script:sb.AppendLine('<p>' + ($script:para -join ' ') + '</p>')
        $script:para.Clear()
    }
}

function Close-Quote {
    if ($script:quote.Count -gt 0) {
        [void]$script:sb.AppendLine('<blockquote><p>' + ($script:quote -join ' ') + '</p></blockquote>')
        $script:quote.Clear()
    }
}

function Close-List {
    if ($script:listType) {
        [void]$script:sb.AppendLine("</$($script:listType)>")
        $script:listType = $null
    }
}

function Close-Table {
    if ($script:table.Count -eq 0) { return }

    $rows = $script:table
    $sepIndex = -1
    for ($i = 0; $i -lt $rows.Count; $i++) {
        if (Test-TableSeparator $rows[$i]) { $sepIndex = $i; break }
    }

    [void]$script:sb.AppendLine('<div class="table-wrap"><table>')

    $startBody = 0
    if ($sepIndex -eq 1) {
        $header = Split-TableRow $rows[0]
        $allEmpty = $true
        foreach ($h in $header) { if ($h -ne '') { $allEmpty = $false } }
        if (-not $allEmpty) {
            [void]$script:sb.AppendLine('<thead><tr>')
            foreach ($h in $header) {
                [void]$script:sb.AppendLine('<th>' + (ConvertTo-InlineHtml (ConvertTo-HtmlText $h)) + '</th>')
            }
            [void]$script:sb.AppendLine('</tr></thead>')
        }
        $startBody = 2
    }

    [void]$script:sb.AppendLine('<tbody>')
    for ($i = $startBody; $i -lt $rows.Count; $i++) {
        if (Test-TableSeparator $rows[$i]) { continue }
        [void]$script:sb.AppendLine('<tr>')
        foreach ($c in (Split-TableRow $rows[$i])) {
            [void]$script:sb.AppendLine('<td>' + (ConvertTo-InlineHtml (ConvertTo-HtmlText $c)) + '</td>')
        }
        [void]$script:sb.AppendLine('</tr>')
    }
    [void]$script:sb.AppendLine('</tbody></table></div>')
    $script:table.Clear()
}

function Close-AllBlocks {
    Close-Paragraph
    Close-Quote
    Close-List
    Close-Table
}

# ------------------------------------------------------------- conversion ----

function Convert-MarkdownToBodyHtml {
    param([string[]]$Lines)

    $script:sb       = New-Object System.Text.StringBuilder
    $script:para     = New-Object System.Collections.ArrayList
    $script:quote    = New-Object System.Collections.ArrayList
    $script:table    = New-Object System.Collections.ArrayList
    $script:listType = $null
    $script:toc      = New-Object System.Collections.ArrayList

    $inCode  = $false
    $firstH1 = $true

    foreach ($rawLine in $Lines) {
        $line = $rawLine -replace "`t", '    '

        # --- fenced code blocks (ASCII process diagrams) -----------------------
        if ($line -match '^\s*```') {
            if ($inCode) {
                [void]$script:sb.AppendLine('</pre>')
                $inCode = $false
            } else {
                Close-AllBlocks
                [void]$script:sb.Append('<pre class="diagram">')
                $inCode = $true
            }
            continue
        }
        if ($inCode) {
            [void]$script:sb.AppendLine((ConvertTo-HtmlText $line))
            continue
        }

        # --- table rows --------------------------------------------------------
        if ($line -match '^\s*\|') {
            Close-Paragraph; Close-Quote; Close-List
            [void]$script:table.Add($line)
            continue
        }
        if ($script:table.Count -gt 0) { Close-Table }

        # --- blank line --------------------------------------------------------
        if ($line.Trim() -eq '') {
            Close-AllBlocks
            continue
        }

        # --- headings ----------------------------------------------------------
        if ($line -match '^(#{1,6})\s+(.*)$') {
            Close-AllBlocks
            $level   = $Matches[1].Length
            $rawText = $Matches[2].Trim()
            $text    = ConvertTo-InlineHtml (ConvertTo-HtmlText $rawText)
            $slug    = New-Slug $rawText
            $class   = ''
            if ($level -eq 1 -and $firstH1) {
                $class = ' class="first"'
                $firstH1 = $false
            }
            [void]$script:sb.AppendLine("<h$level id=""$slug""$class>$text</h$level>")
            if ($level -le 2) {
                [void]$script:toc.Add([pscustomobject]@{ Level = $level; Text = $text; Slug = $slug })
            }
            continue
        }

        # --- horizontal rule ---------------------------------------------------
        if ($line -match '^\s*(-{3,}|\*{3,}|_{3,})\s*$') {
            Close-AllBlocks
            [void]$script:sb.AppendLine('<hr />')
            continue
        }

        # --- blockquote --------------------------------------------------------
        if ($line -match '^\s*>\s?(.*)$') {
            Close-Paragraph; Close-List
            [void]$script:quote.Add((ConvertTo-InlineHtml (ConvertTo-HtmlText $Matches[1])))
            continue
        }
        if ($script:quote.Count -gt 0) { Close-Quote }

        # --- lists -------------------------------------------------------------
        if ($line -match '^\s*[-*+]\s+(.*)$') {
            Close-Paragraph
            if ($script:listType -ne 'ul') {
                Close-List
                [void]$script:sb.AppendLine('<ul>')
                $script:listType = 'ul'
            }
            [void]$script:sb.AppendLine('<li>' + (ConvertTo-InlineHtml (ConvertTo-HtmlText $Matches[1])) + '</li>')
            continue
        }
        if ($line -match '^\s*\d+\.\s+(.*)$') {
            Close-Paragraph
            if ($script:listType -ne 'ol') {
                Close-List
                [void]$script:sb.AppendLine('<ol>')
                $script:listType = 'ol'
            }
            [void]$script:sb.AppendLine('<li>' + (ConvertTo-InlineHtml (ConvertTo-HtmlText $Matches[1])) + '</li>')
            continue
        }
        Close-List

        # --- paragraph text ----------------------------------------------------
        [void]$script:para.Add((ConvertTo-InlineHtml (ConvertTo-HtmlText $line.Trim())))
    }

    if ($inCode) { [void]$script:sb.AppendLine('</pre>') }
    Close-AllBlocks

    [pscustomobject]@{ Body = $script:sb.ToString(); Toc = $script:toc }
}

function New-TocHtml {
    param([System.Collections.ArrayList]$Toc)
    if ($Toc.Count -le 1) { return '' }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<nav class="toc"><h2>Contents</h2><ul>')
    $index = 0
    foreach ($e in $Toc) {
        $index++
        if ($index -eq 1) { continue }   # skip the document title itself
        [void]$sb.AppendLine("<li class=""lvl$($e.Level)""><a href=""#$($e.Slug)"">$($e.Text)</a></li>")
    }
    [void]$sb.AppendLine('</ul></nav>')
    $sb.ToString()
}

# ------------------------------------------------------------------- CSS -----

$css = @'
@page { size: A4; margin: 16mm 14mm 16mm 14mm; }

* { box-sizing: border-box; }

body {
  font-family: "Segoe UI", Calibri, Arial, sans-serif;
  font-size: 9.6pt;
  line-height: 1.5;
  color: #16191d;
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.25; margin: 0 0 .45em;
  page-break-after: avoid; break-after: avoid;
}

h1 {
  font-size: 19pt; font-weight: 600; color: #0f172a;
  padding-bottom: .3em; border-bottom: 2.5px solid #0f172a;
  margin-top: 0; page-break-before: always; break-before: page;
}
h1.first {
  page-break-before: avoid; break-before: auto;
  font-size: 23pt; border-bottom-width: 3px; margin-bottom: .6em;
}
h2 {
  font-size: 13.5pt; font-weight: 600; color: #0f172a; margin-top: 1.5em;
  padding-bottom: .2em; border-bottom: 1px solid #cbd5e1;
}
h3 { font-size: 11.4pt; font-weight: 600; color: #1e293b; margin-top: 1.25em; }
h4 { font-size: 10.2pt; font-weight: 600; color: #334155; margin-top: 1em; }

p { margin: 0 0 .6em; orphans: 3; widows: 3; }

strong { font-weight: 600; color: #0b1220; }

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: .9em; background: #f1f5f9; border: 1px solid #e2e8f0;
  border-radius: 3px; padding: 0 3px;
}

a { color: #1d4ed8; text-decoration: none; }

hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.2em 0; }

ul, ol { margin: 0 0 .7em; padding-left: 1.45em; }
li { margin-bottom: .22em; }

blockquote {
  margin: .8em 0; padding: .55em .9em;
  background: #f8fafc; border-left: 3px solid #64748b;
  page-break-inside: avoid; break-inside: avoid;
}
blockquote p { margin: 0; }

pre.diagram {
  font-family: Consolas, "Courier New", monospace;
  font-size: 7.6pt; line-height: 1.3;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;
  padding: .7em .9em; margin: .8em 0;
  white-space: pre; overflow: hidden;
  page-break-inside: avoid; break-inside: avoid;
}

.table-wrap { margin: .75em 0 1em; }
table { width: 100%; border-collapse: collapse; font-size: 8.4pt; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th {
  background: #0f172a; color: #fff; font-weight: 600; text-align: left;
  padding: 5px 7px; border: 1px solid #0f172a; vertical-align: top;
}
td { padding: 5px 7px; border: 1px solid #d5dce5; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f7f9fc; }
td code, th code { font-size: .92em; }

nav.toc {
  page-break-after: always; break-after: page;
  border: 1px solid #e2e8f0; border-radius: 5px;
  padding: .9em 1.2em 1.1em; background: #fbfdff;
}
nav.toc h2 { margin-top: 0; border: 0; font-size: 14pt; }
nav.toc ul { list-style: none; padding-left: 0; margin: 0; columns: 2; column-gap: 2.2em; }
nav.toc li { margin-bottom: .18em; break-inside: avoid; }
nav.toc li.lvl1 { font-weight: 600; margin-top: .5em; }
nav.toc li.lvl2 { padding-left: 1em; font-size: .95em; color: #334155; }
nav.toc a { color: #0f172a; }
'@

# ------------------------------------------------------------------ main -----

if (-not (Test-Path -LiteralPath $MarkdownPath)) { throw "Markdown file not found: $MarkdownPath" }
$mdFull  = (Resolve-Path -LiteralPath $MarkdownPath).Path
$pdfFull = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PdfPath)

$pdfDir = Split-Path -Parent $pdfFull
if ($pdfDir -and -not (Test-Path -LiteralPath $pdfDir)) {
    New-Item -ItemType Directory -Path $pdfDir -Force | Out-Null
}

Write-Host "Reading  : $mdFull"
$lines  = Get-Content -LiteralPath $mdFull -Encoding UTF8
$result = Convert-MarkdownToBodyHtml -Lines $lines

if (-not $Title) {
    $h1 = $lines | Where-Object { $_ -match '^#\s+' } | Select-Object -First 1
    if ($h1) {
        $Title = ($h1 -replace '^#\s+', '').Trim()
    } else {
        $Title = [System.IO.Path]::GetFileNameWithoutExtension($mdFull)
    }
}

$tocHtml = ''
if (-not $NoToc) { $tocHtml = New-TocHtml -Toc $result.Toc }
$titleEsc = ConvertTo-HtmlText $Title

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>$titleEsc</title>
<style>
$css
</style>
</head>
<body>
$tocHtml
$($result.Body)
</body>
</html>
"@

$htmlPath = [System.IO.Path]::ChangeExtension($pdfFull, '.html')
[System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "HTML     : $htmlPath"

# Rendering lives in one place — see Convert-HtmlToPdf.ps1.
& (Join-Path $PSScriptRoot 'Convert-HtmlToPdf.ps1') -HtmlPath $htmlPath -PdfPath $pdfFull

if (-not $KeepHtml) { Remove-Item -LiteralPath $htmlPath -Force }
