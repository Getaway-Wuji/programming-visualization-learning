param(
  [string]$OutputDirectory = '.artifacts/11.4'
)

$ErrorActionPreference = 'Stop'
$taskWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput = [IO.Path]::GetFullPath((Join-Path $taskWorkspace $OutputDirectory))
$taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskWorkspace '.artifacts/11.4'))
if ($taskOutput -ne $taskAllowed -and -not $taskOutput.StartsWith($taskAllowed + [IO.Path]::DirectorySeparatorChar)) {
  throw 'The performance certificate must stay inside .artifacts/11.4.'
}
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskPfxPath = Join-Path $taskOutput 'conditions-local-tls.pfx'
$taskDerPath = Join-Path $taskOutput 'conditions-local-tls.cer'
$taskMetadataPath = Join-Path $taskOutput 'conditions-local-tls.json'
foreach ($taskPath in @($taskPfxPath, $taskDerPath, $taskMetadataPath)) {
  if (Test-Path -LiteralPath $taskPath) { throw "Refusing to overwrite existing certificate evidence: $taskPath" }
}

# This key and certificate exist only in this process and the task's private files.
# No X509Store, trusted-root installation, or system/browser setting is changed.
$taskRsa = [Security.Cryptography.RSA]::Create(2048)
$taskCert = $null
try {
  $taskRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=localhost', $taskRsa, [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $taskSan = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $taskSan.AddDnsName('localhost')
  $taskSan.AddIpAddress([Net.IPAddress]::Loopback)
  $taskRequest.CertificateExtensions.Add($taskSan.Build())
  $taskRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
  $taskRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    ([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
      [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment), $true
  ))
  $taskServerAuth = [Security.Cryptography.OidCollection]::new()
  $taskServerAuth.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
  $taskRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($taskServerAuth, $false))
  $taskNow = [DateTimeOffset]::UtcNow
  $taskCert = $taskRequest.CreateSelfSigned($taskNow.AddMinutes(-5), $taskNow.AddDays(7))
  $taskPfx = $taskCert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, '')
  $taskDer = $taskCert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  [IO.File]::WriteAllBytes($taskPfxPath, $taskPfx)
  [IO.File]::WriteAllBytes($taskDerPath, $taskDer)
  $taskMetadata = [ordered]@{
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    method = 'System.Security.Cryptography.X509Certificates.CertificateRequest; RSA-2048; SHA-256; ephemeral process key'
    subject = $taskCert.Subject
    san = @('DNS:localhost', 'IP:127.0.0.1')
    notBefore = $taskCert.NotBefore.ToUniversalTime().ToString('o')
    notAfter = $taskCert.NotAfter.ToUniversalTime().ToString('o')
    certificateSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskDer)).ToLowerInvariant()
    pfxFile = 'conditions-local-tls.pfx'
    publicCertificateFile = 'conditions-local-tls.cer'
    password = 'empty; task-local self-signed test key only'
    certificateStoreModified = $false
    globalTrustModified = $false
    limitation = 'Real encrypted loopback HTTPS. The test context must explicitly accept this local self-signed certificate; public deployment certificate trust is not covered.'
  }
  [IO.File]::WriteAllText($taskMetadataPath, ($taskMetadata | ConvertTo-Json -Depth 4) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  $taskMetadata | ConvertTo-Json -Depth 4
}
finally {
  if ($null -ne $taskCert) { $taskCert.Dispose() }
  $taskRsa.Dispose()
}
