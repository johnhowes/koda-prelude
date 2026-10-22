# Pictures and dictation
layer: Agent and live state
kind: module
short: Page captures, speech to text
files: server/capture.js, server/dictation.js
uses: local

Helpers for the message box. `capture.js` takes a picture of a page with a headless Edge or Chrome; `dictation.js` downloads a Whisper model and transcribes speech with whisper.cpp and ffmpeg.

## Responsible for
- Images the person attaches from a page
- Turning a recording into text

## Not its job
- Keeping the draft the picture or text goes into (sessions)

## Owns
- The downloaded speech models in `~/.prelude/`
