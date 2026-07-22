param([Parameter(Mandatory)][string[]]$ContainerName)

$ErrorActionPreference = "Stop"
foreach ($name in $ContainerName) {
  if ($name -notmatch '^netpulse-lab-background-(download|upload)-[a-f0-9]{32}$') {
    throw "Refusing to remove an unexpected container name: $name"
  }
  & docker rm -f $name > $null
  if ($LASTEXITCODE -ne 0) { throw "Could not stop saturation container $name." }
}
