# Milestone 16 phone test steps

The local test environment did not provide an Android phone. These steps collect the remaining
physical-device evidence without treating Chrome emulation as hardware testing.

## Before the test

1. Wait for the normal GitHub Pages deployment to finish, then open the live game in current
   Android Chrome while connected to Wi-Fi.
2. Record the phone model, Android version, Chrome version, date, and whether the test is in a
   browser tab or the installed app.
3. To see the development panel in a browser tab, append `?matchDebug=1` to the game URL. Open a
   3D match and tap the screen once to enable audio. The panel is development-only and is absent
   from the ordinary game UI.

## Browser match and audio

1. Start a full match and leave it running for at least one minute. The panel reports FPS/frame
   time, player count, gait, movement speed, animation phase, left/right foot state, ball position
   and velocity, selected-boot gap, recent touch separation, service-worker control, audio context,
   estimated resident decoded buffers, and the sampled peak.
2. Watch ordinary close-control touches, sprint touches, turns and a deceleration. Take screenshots
   of close control and sprinting. For a touch sample, wait for the panel's `boot gap`/contact values
   to update; note speed and whether the player is turning. Record any touch where the toe is not
   visibly at the ball.
3. Confirm the crowd beds, a whistle, boot/ball sounds, commentary and a goal reaction. In Settings,
   use the voice preview and volume controls. Listen to the normal line, named player, goal call and
   score. Record overlaps, clipping, wrong names/scores or silence.
4. Background Chrome for 10 seconds, return, and continue the match. Check audio recovery and
   animation. Repeat once after locking and unlocking the screen.
5. Let the app run for at least 30 seconds after kick-off with Wi-Fi and no data-saver/2G mode. The
   worker then prefetches compressed offline audio. During this match, confirm the panel says the
   worker is controlling the page. Do not count this as ready until the offline test actually plays
   the recorded sounds.
6. Finish or leave the match. Capture the panel's `MATCH CLOSED` line for decoded bytes after
   release and its session sampled peak. Start a second match in the same page and repeat the audio
   observation; the session peak persists across matches.

## Install and offline PWA

1. Install from the in-app **Install App** button (or Chrome's install prompt). Launch from the home
   screen and verify it opens standalone/full screen. Record the install state and screenshot the
   app icon/launch.
2. While still online, run a match for at least 30 seconds after kick-off to allow the complete
   recorded audio set to be cached. Let the match-started prefetch finish before going offline; it
   can take time on a large commentary library.
3. Close the app, enable airplane mode, and launch it from the home screen. Start a match. Verify
   the game, recorded commentary, stadium beds, reactions, whistles and ball/boot sounds work with
   no connection. This specifically exercises service-worker byte-range handling for streamed MP3
   beds.
4. Turn connectivity back on, open the game, and verify the career/save is present. Record whether
   the worker controls the page and whether the installed mode is reported.

## Collect results

Save screenshots or a short screen recording and note:

```text
Phone / Android / Chrome:
Browser or installed app:
Connection state:
FPS and frame time during match:
Selected-boot gap / visible contact:
Decoded audio current / sampled peak / after-match:
Audio heard (beds, voice preview, match lines, goal, whistle, ball/boot):
Background/resume:
Offline launch and audio:
Service-worker control / installed mode:
Career save after update:
Problems and reproduction steps:
```

The panel's decoded-memory values estimate JavaScript `AudioBuffer` PCM only. They cannot show
Chrome's internal media-stream decoder buffers, total app heap, GPU memory, or operating-system
memory. Report those only if collected separately with Android profiling tools.
