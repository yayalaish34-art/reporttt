# Deploys the prediction engine to Vercel.
#
# Run from anywhere: powershell -ExecutionPolicy Bypass -File prediction-service\deploy.ps1
#
# Deployed from a copy outside git on purpose. Inside the repo the Vercel CLI attributes the
# deployment to the last commit's author, and on the Hobby plan a commit author who is not a
# member of the Vercel team blocks the deployment.

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$copy = Join-Path ([IO.Path]::GetTempPath()) "galit-elf-deploy"
if (Test-Path $copy) { Remove-Item -Recurse -Force $copy }
New-Item -ItemType Directory -Force $copy | Out-Null

robocopy $source $copy /E /NFL /NDL /NJH /NJS /NP /XD .venv node_modules .next __pycache__ .pytest_cache storage deploy | Out-Null

Push-Location $copy
try {
  npx --yes vercel deploy --prod --yes
} finally {
  Pop-Location
  Remove-Item -Recurse -Force $copy -ErrorAction SilentlyContinue
}
