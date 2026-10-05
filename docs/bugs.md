# Bugs

- ~~Oscillators break when trying frequency modulation. Either no sound or output get totally over amplified.~~
  Fixed: the blep oscillators ran away below 0 Hz (now clamped), and FM has its own `fm` inlet so the note frequency stays wired.
