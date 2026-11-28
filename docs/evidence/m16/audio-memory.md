# Audio memory evidence

## Asset sizes

Measured from the checked-in files:

| Group | Files | Compressed size |
|---|---:|---:|
| Stadium MP3s and index | 26 MP3s plus index | 1,414,909 bytes (1.35 MiB) |
| Commentary MP3s and index | 1,212 files | 7,157,034 bytes (6.83 MiB) |
| Total audio folders | 1,238 files | 8,571,943 bytes (8.18 MiB) |

The two crowd beds are 31.5 s and 25.5 s, stereo. Fully decoding both at 48 kHz would require
21,888,000 bytes (20.87 MiB) for PCM, before browser overhead. They now stream from cached MP3s via
media elements instead of Web Audio AudioBuffers. The browser's internal streaming decoder buffers
are not exposed for exact measurement.

## Decoded PCM policy and tests

`AudioBuffer` byte counts use its actual `length × numberOfChannels × 4` memory footprint. Stadium
reactions use a 10 MiB cache with space estimated and evicted before each sequential decode.
Commentary uses a 7 MiB / 48-clip cache, decodes one segment at a time and warms compressed files
without retaining a heap copy of the full match prefetch. Active source-node buffers count once even
if the cache has evicted them. Leaving a match stops sources and releases both decoded caches;
session high-water values remain visible for later matches in that page session.

Automated tests pass for byte-bounded reaction loading, stream-bed wiring, commentary sequencing,
buffer release and service-worker offline range reads. These use fake Web Audio and therefore test
the byte accounting and lifecycle rules, not the Android process's total heap.

## Measurements not yet collected on a phone

There is no browser-process memory profile from a full match, background/resume, a second match or
installed-app exit in this environment. The `?matchDebug=1` diagnostic estimates resident JS
AudioBuffers, shows a session-sampled combined peak, and persists after match exit to show the
post-match value. It cannot see browser-internal media decoder memory, the JS heap outside audio, or
GPU allocations. Follow `ANDROID_TEST_STEPS.md` for the physical-device collection.
