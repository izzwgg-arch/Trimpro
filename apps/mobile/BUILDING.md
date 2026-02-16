# TrimPro Field Mobile Build Guide

## Prerequisites

- Node.js 18+
- Expo account
- Android device or emulator for testing

## Setup

1. `cd apps/mobile`
2. `npm install`
3. Install EAS CLI:
   - global: `npm i -g eas-cli`
   - or use `npx eas` for every command
4. Login to Expo:
   - `expo login`
5. Configure EAS project (first time only):
   - `eas build:configure`

## Environment

Set backend API URL before build/run:

- PowerShell: `$env:EXPO_PUBLIC_API_URL="https://app.trimprony.com"`
- Bash: `export EXPO_PUBLIC_API_URL=https://app.trimprony.com`

For Android emulator local backend, use `http://10.0.2.2:3000`.

## Development

- `npm run dev`
- `npm run android`

## Build APK (Internal Distribution)

1. `cd apps/mobile`
2. Ensure `EXPO_PUBLIC_API_URL` is set
3. Run:
   - `npm run build:apk`
4. EAS prints a build URL when queued/finished.
5. Open that URL and download the generated `.apk`.

## Build AAB (Play Store / Production)

1. `cd apps/mobile`
2. Ensure production API URL is set
3. Run:
   - `npm run build:aab`
4. Download `.aab` from EAS build page for Play Console upload.

## VoIP and Dev Build Notes

The Calls module is scaffolded for SIP configuration and dialing UI.
If your final SIP client requires native modules not supported in Expo Go:

- Use an Expo development build:
  - `eas build -p android --profile preview`
- Install the generated dev client APK on testers' devices.
- Continue development/testing with `npx expo start --dev-client`.

This is separate from production builds:

- **Testing build**: development client / preview APK
- **Production build**: store AAB

