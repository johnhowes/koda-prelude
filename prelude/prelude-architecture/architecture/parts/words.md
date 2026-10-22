# Words
layer: Shared helpers
kind: module
short: Times and text as words
files: server/words.js
uses:

Small helpers that turn times and text into the words pages show: "2 minutes ago", "today at 09:41", "6:40", plain text from markdown, sentences, clipped lines. It imports nothing, so any part may use it.

## Responsible for
- `ago`, `whenWords`, `startedWords`, `sinceWords`
- `plain`, `sentences`, `clip`

## Not its job
- Anything about designs, sessions or pages

## Owns
- Nothing
