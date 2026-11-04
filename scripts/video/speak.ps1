# Demo video, part 2: synthesise each scene's narration with Windows' built-in speech (no network).
# Usage: powershell -File scripts/video/speak.ps1   (writes video-out/voice-<id>.wav)
Add-Type -AssemblyName System.Speech
$scenes = Get-Content -Raw -Encoding UTF8 "scripts/video/narration.json" | ConvertFrom-Json
New-Item -ItemType Directory -Force "video-out" | Out-Null
foreach ($s in $scenes) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice("Microsoft Zira Desktop")
  $synth.Rate = 0
  $path = Join-Path (Resolve-Path "video-out") "voice-$($s.id).wav"
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($s.text)
  $synth.Dispose()
  Write-Output "voice-$($s.id).wav"
}
