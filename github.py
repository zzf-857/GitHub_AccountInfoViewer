$token = $env:GITHUB_TOKEN
if (-not $token) {
  $token = $env:GITHUB_PAT
}
if (-not $token) {
  throw "请先设置 GITHUB_TOKEN 或 GITHUB_PAT 环境变量。"
}

$headers = @{
  Accept = "application/vnd.github+json"
  Authorization = "Bearer $token"
  "X-GitHub-Api-Version" = "2026-03-10"
}

$page = 1
$all = @()

do {
  $url = "https://api.github.com/user/starred?sort=created&direction=desc&per_page=100&page=$page"
  $items = Invoke-RestMethod -Uri $url -Headers $headers -Method Get

  if ($items.Count -gt 0) {
    $all += $items | ForEach-Object {
      [PSCustomObject]@{
        full_name   = $_.full_name
        url         = $_.html_url
        description = $_.description
        language    = $_.language
        stars       = $_.stargazers_count
        updated_at  = $_.updated_at
      }
    }
    $page++
  }
} while ($items.Count -gt 0)

$all | Export-Csv -Path ".\github_starred_repos.csv" -NoTypeInformation -Encoding UTF8
Write-Host "导出完成：github_starred_repos.csv"
