<#
.SYNOPSIS
  Takes a complete, READ-ONLY copy of the Prism database onto THIS computer.

.DESCRIPTION
  Changes NOTHING in the database and installs NOTHING into it. It only reads.
  It does not use Prism's own backup feature: it uses PostgreSQL's standard
  pg_dump (run inside Docker), so this first copy stands on its own.

  What it saves, into a new dated folder under  Documents\Prism-backups\ :
    prism-app-data.dump   every table in "public" and "wurxbase" (creators, brands,
                          offers, content, contests, reports, Paid Collabs ...)
    prism-accounts.dump   the sign-in accounts (auth.users, auth.identities):
                          emails and scrambled passwords
    row-counts.txt        how many rows every table had at that moment
    CHECKSUMS.txt         a fingerprint of each file, to detect damage later
    README.txt            how to use these files

  It does NOT include uploaded pictures (logos, photos) or secrets. See README.txt.

.PARAMETER ConnectionString
  Optional. If you leave it out you are asked, and what you paste is hidden.
  Use the SESSION POOLER string from the Supabase dashboard (Project settings >
  Database > Connection string > "Session pooler"), with your database password
  put in place of [YOUR-PASSWORD]. The password is never written to disk.

.PARAMETER OutDir
  Where to put the dated folder. Default: Documents\Prism-backups

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\ops\backup-real-database.ps1
#>
param(
  [string]$ConnectionString,
  [string]$OutDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Prism-backups'),
  [string]$Image = 'postgres:17'
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "`nSTOPPED: $msg" -ForegroundColor Red; exit 1 }

Write-Host "`nPrism database backup (read-only)" -ForegroundColor Cyan
Write-Host "This only READS the database. It changes nothing in it.`n"

# ---- the connection string, hidden while typed, never saved --------------------
if (-not $ConnectionString) {
  $secure = Read-Host 'Paste the database connection string (nothing will show as you paste)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $ConnectionString = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$ConnectionString = $ConnectionString.Trim()
if ($ConnectionString -notmatch '^postgres(ql)?://') { Fail 'That does not look like a database connection string (it should start with postgresql://).' }
if ($ConnectionString -match '\[YOUR-PASSWORD\]') { Fail 'Replace [YOUR-PASSWORD] with your real database password first.' }

# ---- Docker is what runs pg_dump (nothing to install into the database) -------
$null = docker version --format '{{.Server.Version}}' 2>$null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop is not running. Start it, wait until it says it is running, then run this again.' }
$have = docker images -q $Image 2>$null
if (-not $have) { Write-Host "Downloading $Image once (about 400 MB) ..."; docker pull $Image | Out-Null }

$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$dir = Join-Path $OutDir $stamp
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host "Saving into:  $dir`n" -ForegroundColor Green

function Run-Pg([string]$script) {
  # the connection string goes in through the environment, not the command line
  docker run --rm -e "PGCONN=$ConnectionString" -v "${dir}:/out" $Image sh -c $script
  if ($LASTEXITCODE -ne 0) { Fail "A step failed (see the message above). Nothing in the database was changed." }
}

# ---- 0. can we connect, and is it the right database? --------------------------
Write-Host '1/5  Checking the connection ...'
Run-Pg 'psql "$PGCONN" -At -c "select current_database() || '' as '' || current_user || '', Postgres '' || current_setting(''server_version'')"'

# ---- 1. row counts, exact, taken first ----------------------------------------
Write-Host '2/5  Counting every table ...'
@'
select table_schema || '.' || table_name || ' | ' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema in ('public','wurxbase') or (table_schema = 'auth' and table_name in ('users','identities')))
 order by 1;
'@ | Set-Content (Join-Path $dir 'counts.sql') -Encoding ascii
Run-Pg 'psql "$PGCONN" -At -f /out/counts.sql > /out/row-counts.txt'
Remove-Item (Join-Path $dir 'counts.sql')

# ---- 2. the application data ---------------------------------------------------
Write-Host '3/5  Copying the application data (public + wurxbase) ...'
Run-Pg 'pg_dump "$PGCONN" --format=custom --no-owner --no-privileges --schema=public --schema=wurxbase --file=/out/prism-app-data.dump'

# ---- 3. the sign-in accounts ---------------------------------------------------
Write-Host '4/5  Copying the sign-in accounts ...'
Run-Pg 'pg_dump "$PGCONN" --format=custom --no-owner --no-privileges --data-only --table=auth.users --table=auth.identities --file=/out/prism-accounts.dump'

# ---- 4. prove the files are readable and complete -----------------------------
Write-Host '5/5  Checking the copies ...'
$dataTables = (Get-Content (Join-Path $dir 'row-counts.txt') | Where-Object { $_ -notmatch '^auth\.' -and $_.Trim() }).Count
$authTables = (Get-Content (Join-Path $dir 'row-counts.txt') | Where-Object { $_ -match '^auth\.' }).Count
Run-Pg 'pg_restore --list /out/prism-app-data.dump > /out/list-app.txt && pg_restore --list /out/prism-accounts.dump > /out/list-accounts.txt'
$nums = @(
  (Select-String -Path (Join-Path $dir 'list-app.txt') -Pattern ' TABLE DATA ' -SimpleMatch).Count,
  (Select-String -Path (Join-Path $dir 'list-accounts.txt') -Pattern ' TABLE DATA ' -SimpleMatch).Count
)
Remove-Item (Join-Path $dir 'list-app.txt'), (Join-Path $dir 'list-accounts.txt')
if ($nums[0] -ne $dataTables) { Fail "The copy holds data for $($nums[0]) tables but the database has $dataTables. Do not rely on it; run this again." }
if ($nums[1] -ne $authTables) { Fail "The accounts copy holds $($nums[1]) tables but expected $authTables. Run this again." }
foreach ($f in 'prism-app-data.dump', 'prism-accounts.dump', 'row-counts.txt') {
  if ((Get-Item (Join-Path $dir $f)).Length -lt 100) { Fail "$f is empty. Run this again." }
}

# ---- 5. fingerprints and a how-to ----------------------------------------------
Get-ChildItem $dir -File | Where-Object { $_.Name -notin 'CHECKSUMS.txt', 'README.txt' } |
  ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name } |
  Set-Content (Join-Path $dir 'CHECKSUMS.txt') -Encoding ascii

@"
PRISM DATABASE BACKUP   taken $(Get-Date -Format 'yyyy-MM-dd HH:mm')

These files are a complete copy of the database's DATA at that moment.
KEEP THEM PRIVATE. They contain every account and every (scrambled) password.
Copy this whole folder to a second place too (an external drive or private cloud
storage). One copy on one computer is not a backup.

  prism-app-data.dump    tables in "public" and "wurxbase" (structure and data)
  prism-accounts.dump    sign-in accounts (auth.users and auth.identities), data only
  row-counts.txt         exact row counts per table at that moment
  CHECKSUMS.txt          SHA-256 fingerprints: re-check these to detect a damaged file

NOT included (they live elsewhere):
  - uploaded pictures (brand logos, creator photos): use the Download button in
    Prism > Data > Backup data with "Include the pictures" ticked
  - secrets: Edge Function secrets, API keys, the Supabase Vault
  - the database structure for the "auth" schema (Supabase creates that itself)

TO USE THEM (needs an engineer; do not guess):
  1. Make a Supabase project with the right structure:  supabase db push
  2. Restore:  pg_restore --data-only --disable-triggers  into that database
     (or use Prism's own restore: pnpm restore:database, see docs/guides/BACKUPS.md)
  Practise on a throwaway project first. Never restore over the live database
  without first taking a fresh copy of it.
"@ | Set-Content (Join-Path $dir 'README.txt') -Encoding utf8

Write-Host "`nDONE. The backup is here:" -ForegroundColor Green
Write-Host "  $dir`n" -ForegroundColor Green
Get-ChildItem $dir -File | ForEach-Object { '  {0,-24} {1,12:N0} bytes' -f $_.Name, $_.Length }
Write-Host "`n  $dataTables tables copied (checked against the database). Rows per table: row-counts.txt"
Write-Host "  Now copy that folder somewhere else as well.`n"
