# PowerShell script to base64-encode a GitHub App private key
# Usage: .\encode-key.ps1 <path-to-private-key.pem>

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyPath
)

if (-not (Test-Path $KeyPath)) {
    Write-Host "Error: File not found: $KeyPath" -ForegroundColor Red
    exit 1
}

try {
    $keyContent = Get-Content -Path $KeyPath -Raw
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($keyContent)
    $base64Encoded = [Convert]::ToBase64String($bytes)
    
    Write-Host "`n✅ Base64-encoded private key:`n" -ForegroundColor Green
    Write-Host $base64Encoded
    Write-Host "`n📋 Copy the above and use it as GITHUB_REVIEW_APP_PRIVATE_KEY in your .env file`n" -ForegroundColor Cyan
} catch {
    Write-Host "Error encoding key: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
