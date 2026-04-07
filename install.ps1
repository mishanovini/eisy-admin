# ─── Super eisy Installer for Windows ─────────────────────────────────────────
# Requires: PowerShell 5.1+ (pre-installed on Windows 10/11)
# Usage:    powershell -c "irm https://raw.githubusercontent.com/mishanovini/eisy-admin/master/install.ps1 | iex"
# ──────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ─── Configuration ────────────────────────────────────────────────────────────
$RepoOwner    = "mishanovini"
$RepoName     = "eisy-admin"
$DefaultHost  = "192.168.4.123"
$DefaultUser  = "admin"
$KnownPorts   = @(8443, 8080, 443, 80)
$ExtendedPorts = @(3000, 5000, 8000, 8888, 9443)
$ProbeTimeout = 3

# ─── Output Helpers ───────────────────────────────────────────────────────────
function Write-Info    { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Blue }
function Write-Ok      { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Err     { param([string]$Msg) Write-Host "[error] $Msg" -ForegroundColor Red }

function Show-Banner {
    Write-Host ""
    Write-Host "  +=======================================+" -ForegroundColor Cyan
    Write-Host "  |        Super eisy Installer           |" -ForegroundColor Cyan
    Write-Host "  +=======================================+" -ForegroundColor Cyan
    Write-Host ""
}

# ─── TLS Bypass for Self-Signed Certs ─────────────────────────────────────────
function Initialize-TlsBypass {
    # PS 5.1 uses .NET ServicePointManager for cert validation
    if (-not ([System.Management.Automation.PSTypeName]'SuperEisyTrustAll').Type) {
        Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class SuperEisyTrustAll : ICertificatePolicy {
    public bool CheckValidationResult(
        ServicePoint srvPoint, X509Certificate certificate,
        WebRequest request, int certificateProblem) {
        return true;
    }
}
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object SuperEisyTrustAll
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
}

# ─── Prompt for Credentials ──────────────────────────────────────────────────
function Get-EisyCredentials {
    Write-Host "  eisy Connection Details" -ForegroundColor White
    Write-Host "  Press Enter to accept defaults shown in [brackets]" -ForegroundColor DarkGray
    Write-Host ""

    $script:EisyHost = Read-Host "  eisy IP address [$DefaultHost]"
    if ([string]::IsNullOrWhiteSpace($script:EisyHost)) { $script:EisyHost = $DefaultHost }

    $script:EisyUser = Read-Host "  Username [$DefaultUser]"
    if ([string]::IsNullOrWhiteSpace($script:EisyUser)) { $script:EisyUser = $DefaultUser }

    $securePass = Read-Host "  Password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
    $script:EisyPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    if ([string]::IsNullOrWhiteSpace($script:EisyPass)) { $script:EisyPass = "admin" }

    $pair = "${script:EisyUser}:${script:EisyPass}"
    $script:AuthBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
}

# ─── Port Discovery ──────────────────────────────────────────────────────────
function Test-EisyPort {
    param([string]$Host_, [string]$Proto, [int]$Port)

    $url = "${Proto}://${Host_}:${Port}/rest/nodes"
    $headers = @{ Authorization = "Basic $script:AuthBase64" }

    try {
        $response = Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec $ProbeTimeout -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200 -and $response.Content -match "<nodes") {
            return "ok"
        }
        return "not_eisy"
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 401) {
            return "auth_failed"
        }
        return "error"
    }
}

function Find-Eisy {
    Write-Info "Discovering eisy at ${script:EisyHost}..."
    Write-Host ""

    $script:EisyProto = $null
    $script:EisyPort = $null
    $authFailed = $false

    # Try known ports
    foreach ($port in $KnownPorts) {
        foreach ($proto in @("https", "http")) {
            Write-Host "  Probing ${proto}://${script:EisyHost}:${port}..." -ForegroundColor DarkGray -NoNewline
            $result = Test-EisyPort -Host_ $script:EisyHost -Proto $proto -Port $port

            if ($result -eq "ok") {
                Write-Host "`r  Found eisy at ${proto}://${script:EisyHost}:${port}      " -ForegroundColor Green
                $script:EisyProto = $proto
                $script:EisyPort = $port
                return $true
            }
            elseif ($result -eq "auth_failed") {
                Write-Host "`r  Port ${port} (${proto}) - authentication failed      " -ForegroundColor Yellow
                $authFailed = $true
            }
            else {
                Write-Host "`r  Port ${port} (${proto}) - no response      " -ForegroundColor DarkGray
            }
        }
    }

    # Try extended ports
    Write-Info "Trying additional ports..."
    foreach ($port in $ExtendedPorts) {
        foreach ($proto in @("https", "http")) {
            Write-Host "  Probing ${proto}://${script:EisyHost}:${port}..." -ForegroundColor DarkGray -NoNewline
            $result = Test-EisyPort -Host_ $script:EisyHost -Proto $proto -Port $port

            if ($result -eq "ok") {
                Write-Host "`r  Found eisy at ${proto}://${script:EisyHost}:${port}      " -ForegroundColor Green
                $script:EisyProto = $proto
                $script:EisyPort = $port
                return $true
            }
            else {
                Write-Host "`r  Port ${port} (${proto}) - no response      " -ForegroundColor DarkGray
            }
        }
    }

    # Discovery failed
    Write-Host ""
    if ($authFailed) {
        Write-Err "Found eisy but authentication failed. Check your username and password."
    }
    else {
        Write-Err "Could not find eisy at ${script:EisyHost}."
        Write-Host ""
        Write-Host "  Troubleshooting:" -ForegroundColor White
        Write-Host "  - Is your eisy powered on?"
        Write-Host "  - Is it connected to the same network as this computer?"
        Write-Host "  - Is the IP address correct? Check your router's DHCP table."
    }

    # Offer manual port entry
    Write-Host ""
    $manualPort = Read-Host "  Enter port manually (or press Enter to abort)"
    if ([string]::IsNullOrWhiteSpace($manualPort)) {
        exit 2
    }

    $manualProto = Read-Host "  Protocol (https/http) [https]"
    if ([string]::IsNullOrWhiteSpace($manualProto)) { $manualProto = "https" }

    $script:EisyProto = $manualProto
    $script:EisyPort = [int]$manualPort
    Write-Info "Using ${script:EisyProto}://${script:EisyHost}:${script:EisyPort}"
    return $true
}

# ─── Download Latest Release ─────────────────────────────────────────────────
function Get-LatestRelease {
    Write-Info "Fetching latest release from GitHub..."

    $apiUrl = "https://api.github.com/repos/${RepoOwner}/${RepoName}/releases/latest"

    try {
        $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -ErrorAction Stop
    }
    catch {
        Write-Err "Failed to fetch release info from GitHub."
        Write-Err "Check your internet connection or visit:"
        Write-Err "  https://github.com/${RepoOwner}/${RepoName}/releases"
        exit 3
    }

    $script:ReleaseTag = $release.tag_name
    $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1

    if (-not $zipAsset) {
        Write-Err "No zip file found in the latest release."
        Write-Err "Visit: https://github.com/${RepoOwner}/${RepoName}/releases"
        exit 3
    }

    Write-Info "Downloading Super eisy ${script:ReleaseTag}..."

    $script:TempDir = Join-Path $env:TEMP "super-eisy-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null

    $script:ZipPath = Join-Path $script:TempDir "super-eisy.zip"

    try {
        # Use .NET WebClient for progress display
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add("User-Agent", "Super-eisy-Installer")
        $webClient.DownloadFile($zipAsset.browser_download_url, $script:ZipPath)
    }
    catch {
        Write-Err "Download failed: $_"
        exit 3
    }

    Write-Ok "Downloaded ${script:ReleaseTag}"
}

# ─── Extract ──────────────────────────────────────────────────────────────────
function Expand-Release {
    Write-Info "Extracting files..."

    $script:ExtractDir = Join-Path $script:TempDir "extracted"
    Expand-Archive -Path $script:ZipPath -DestinationPath $script:ExtractDir -Force

    $script:Files = Get-ChildItem -Path $script:ExtractDir -Recurse -File
    $script:FileCount = $script:Files.Count

    Write-Ok "Extracted $($script:FileCount) files"
}

# ─── Upload to eisy ──────────────────────────────────────────────────────────
function Send-Files {
    $baseUrl = "${script:EisyProto}://${script:EisyHost}:${script:EisyPort}"

    Write-Host ""
    Write-Host "  Uploading to eisy..." -ForegroundColor White
    Write-Host ""

    $uploaded = 0
    $failed = 0
    $failedFiles = @()
    $current = 0

    foreach ($file in $script:Files) {
        $relPath = $file.FullName.Substring($script:ExtractDir.Length + 1).Replace('\', '/')
        $current++

        # Format file size
        if ($file.Length -gt 1MB) {
            $sizeDisplay = "$([math]::Floor($file.Length / 1MB)) MB"
        }
        elseif ($file.Length -gt 1KB) {
            $sizeDisplay = "$([math]::Floor($file.Length / 1KB)) KB"
        }
        else {
            $sizeDisplay = "$($file.Length) B"
        }

        Write-Host "  [$current/$($script:FileCount)] $relPath ($sizeDisplay) " -NoNewline

        $uploadUrl = "${baseUrl}/file/upload/WEB/console/${relPath}?load=n"
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $headers = @{
            Authorization  = "Basic $script:AuthBase64"
        }

        try {
            $response = Invoke-WebRequest -Uri $uploadUrl -Method Post `
                -ContentType "application/octet-stream" `
                -Body $bytes `
                -Headers $headers `
                -UseBasicParsing `
                -TimeoutSec 60 `
                -ErrorAction Stop

            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                Write-Host "OK" -ForegroundColor Green
                $uploaded++
            }
            else {
                Write-Host "FAILED (HTTP $($response.StatusCode))" -ForegroundColor Red
                $failed++
                $failedFiles += $relPath
            }
        }
        catch {
            $statusCode = "?"
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }
            Write-Host "FAILED (HTTP $statusCode)" -ForegroundColor Red
            $failed++
            $failedFiles += $relPath
        }
    }

    $script:UploadedCount = $uploaded
    $script:FailedCount = $failed
    $script:FailedFiles = $failedFiles
}

# ─── Summary ──────────────────────────────────────────────────────────────────
function Show-Summary {
    Write-Host ""

    if ($script:FailedCount -eq 0) {
        Write-Host "  +=======================================+" -ForegroundColor Green
        Write-Host "  |      Installation Complete!           |" -ForegroundColor Green
        Write-Host "  +=======================================+" -ForegroundColor Green
        Write-Host ""
        Write-Ok "Uploaded $($script:UploadedCount)/$($script:FileCount) files (Super eisy ${script:ReleaseTag})"
        Write-Host ""
        Write-Host "  Open in your browser:" -ForegroundColor White
        Write-Host "  ${script:EisyProto}://${script:EisyHost}:${script:EisyPort}/WEB/console/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  To update later, run this same command again." -ForegroundColor DarkGray
        Write-Host ""
    }
    else {
        Write-Host "  +=======================================+" -ForegroundColor Yellow
        Write-Host "  |    Installation Partially Complete    |" -ForegroundColor Yellow
        Write-Host "  +=======================================+" -ForegroundColor Yellow
        Write-Host ""
        Write-Warn "Uploaded $($script:UploadedCount)/$($script:FileCount) files. $($script:FailedCount) failed:"
        foreach ($f in $script:FailedFiles) {
            Write-Host "    - $f" -ForegroundColor Red
        }
        Write-Host ""
        Write-Host "  Re-run this command to retry failed uploads." -ForegroundColor DarkGray
        Write-Host ""
        exit 5
    }
}

# ─── Main ─────────────────────────────────────────────────────────────────────
try {
    Show-Banner
    Initialize-TlsBypass
    Get-EisyCredentials
    Write-Host ""
    $found = Find-Eisy
    if (-not $found -or -not $script:EisyPort) {
        Write-Err "Could not connect to eisy."
        exit 2
    }
    Write-Host ""
    Get-LatestRelease
    Expand-Release
    Send-Files
    Show-Summary
}
finally {
    # Cleanup temp files
    if ($script:TempDir -and (Test-Path $script:TempDir)) {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
