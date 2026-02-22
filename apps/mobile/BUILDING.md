# TrimPro Field Build Guide

## Build an Android APK

1) `cd apps/mobile`  
2) `npm install`  
3) Confirm Expo and EAS authentication is already connected  
4) `npm run build:apk`  
5) Open the EAS build URL printed in the terminal and download the APK from that build page

## Build Commands

- APK (internal testing): `npm run build:apk`
- AAB (store): `npm run build:aab`
- OTA preview update: `npm run ota:preview`
- OTA production update: `npm run ota:prod`

## When to Build a New APK vs OTA Update

- Build a new APK when native runtime changes are included, package configuration changes, permissions change, or you need a fresh installable for testers.
- Use OTA update when changes are JavaScript or styling only and the installed app runtime already matches.

