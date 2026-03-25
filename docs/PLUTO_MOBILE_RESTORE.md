# Pluto Mobile Restore Point

## CORRECTION NOTICE

The original `pluto-mobile` tag was created from the **wrong commit** (`c8fef5e`).
That commit contained only minor navigation cleanup and did NOT include the full
feature set that was on the device at the time "Pluto" was intended to capture.

**The corrected Pluto snapshot is commit `a1337d7`.**
The tag and branch have been force-updated to this commit.

---

## Snapshot Details

| Field          | Value                                      |
|----------------|--------------------------------------------|
| Snapshot Name  | Pluto Mobile                               |
| Commit Hash    | `a1337d7466f1e0453dcb713ac37cd2736f2bcbf5` |
| Short Hash     | `a1337d7`                                  |
| Commit Message | `docs: add Jupiter restore manifest`       |
| Tag            | `pluto-mobile`                             |
| Branch         | `snapshot/pluto-mobile`                    |
| Restore Branch | `restore/pluto-correct`                    |
| Verified Date  | 2026-03-01                                 |

---

## What is in this snapshot

This is the full feature-complete mobile app state that was running on device
at the time the Pluto snapshot was intended to be created. It includes:

- WhatsApp-style chat with voice notes, attachments, video playback
- react-native-big-calendar Schedule screen (Day/Week/Month views)
- FilterSheet for schedule employee filtering
- JobDetail with INSTALLATION_COMPLETE and FINISHING_COMPLETE statuses
- Tasks screen with create flow and permission-based assignment
- Issues screen with create flow
- VoiceNoteBubble component
- MessageBubble with swipe-to-reply, media handling
- MediaViewer component for in-app viewing
- Keyboard avoidance / composer fixes
- Correct chat color theme

---

## Why the Original Tag Was Wrong

| Item                  | Old (wrong) tag     | Corrected tag       |
|-----------------------|---------------------|---------------------|
| Commit                | `c8fef5e`           | `a1337d7`           |
| Features              | Minor nav cleanup only | Full feature set |
| Calendar (big-cal)    | Missing             | Present             |
| VoiceNoteBubble       | Missing             | Present             |
| FilterSheet           | Missing             | Present             |
| JobDetail statuses    | Missing             | Present             |

---

## Restore Commands

To restore the mobile app to this exact state:

  git checkout -b restore/pluto-correct a1337d7
  git rev-parse HEAD
  # Expected: a1337d7466f1e0453dcb713ac37cd2736f2bcbf5

  cd apps/mobile
  EXPO_TOKEN=<your-token> npx eas-cli build --platform android --profile preview --non-interactive

To restore only the apps/mobile/ directory on an existing branch:

  git checkout a1337d7 -- apps/mobile/

---

## Approved Mobile Restore Point

`a1337d7` is the single approved restore point for the Pluto mobile snapshot.

Do not use `c8fef5e` for restores. It is the old, incorrect tag target.
