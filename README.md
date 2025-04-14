# autosub3

To install dependencies:

```bash
bun install
```

To run:

```bash
# Create a project
mkdir projects/myproject
cd projects/myproject

# Download the audio from YouTube
../../scripts/download_audio_from_youtube https://youtu.be/video_id

# Perform VAD on it to find out utterance boundaries
bun ../../scripts/vad.ts

# Create "notes.txt" and include information about the session
# This helps the model to understand the context of the audio and
# generate better captions
touch notes.txt

# Transcribe the audio and generate a caption file
bun ../../scripts/generateCaptions.ts
```
