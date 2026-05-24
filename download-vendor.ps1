# Run this once from PowerShell to download Supabase + Chart.js as local vendor files.
# This fixes Edge's Tracking Prevention blocking localStorage for jsdelivr CDN scripts.

$vendorDir = "$PSScriptRoot\app\vendor"
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

Write-Host "Downloading supabase.min.js..." -ForegroundColor Cyan
Invoke-WebRequest `
    -Uri "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" `
    -OutFile "$vendorDir\supabase.min.js"

Write-Host "Downloading chart.min.js..." -ForegroundColor Cyan
Invoke-WebRequest `
    -Uri "https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js" `
    -OutFile "$vendorDir\chart.min.js"

Write-Host ""
Write-Host "Done! Files saved to app\vendor\" -ForegroundColor Green
Get-ChildItem $vendorDir | Format-Table Name, Length
