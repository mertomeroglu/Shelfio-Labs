param(
  [string]$Message = "Update Shelfio"
)

Write-Host "Shelfio local push basliyor..." -ForegroundColor Cyan

git status

git add .

git commit -m "$Message"

if ($LASTEXITCODE -ne 0) {
  Write-Host "Commit atlanmis olabilir. Degisiklik yoksa normaldir." -ForegroundColor Yellow
}

git push origin main

Write-Host "GitHub push tamamlandi." -ForegroundColor Green