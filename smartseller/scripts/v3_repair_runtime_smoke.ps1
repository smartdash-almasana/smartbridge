param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$CronSecret
)

$headers = @{ "x-cron-secret" = $CronSecret }

Write-Host "Running V3 orchestrator smoke..."
$url = "$BaseUrl/api/v3/worker/pipeline/run?limit=10&lease_seconds=300&lookback_days=3"
$response = Invoke-RestMethod -Method Get -Uri $url -Headers $headers

if (-not $response.ok) {
  throw "Orchestrator smoke failed: $($response | ConvertTo-Json -Depth 8)"
}

Write-Host "Orchestrator status:" $response.execution.status
Write-Host "Heartbeat worker:" $response.execution.worker_name
Write-Host "Diagnostics:"
$response.diagnostics | ConvertTo-Json -Depth 8 | Write-Host
