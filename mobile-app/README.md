# Trim Pro Mobile App

React Native mobile application for Trim Pro Field Service Management.

## Setup

### Prerequisites
- Node.js 18+
- React Native CLI
- iOS: Xcode 14+ (for iOS development)
- Android: Android Studio (for Android development)

### Installation

```bash
cd mobile-app
npm install
# or
yarn install
```

### iOS Setup

```bash
cd ios
pod install
cd ..
npm run ios
```

### Android Setup

```bash
npm run android
```

## Project Structure

```
mobile-app/
├── src/
│   ├── screens/          # Screen components
│   │   ├── Auth/
│   │   ├── Dashboard/
│   │   ├── Jobs/
│   │   ├── Schedule/
│   │   └── Tasks/
│   ├── components/       # Reusable components
│   ├── navigation/       # Navigation setup
│   ├── services/         # API services
│   ├── store/            # State management
│   └── utils/            # Utility functions
├── android/              # Android native code
├── ios/                  # iOS native code
└── package.json
```

## Features

- Authentication (JWT)
- Dashboard with KPIs
- Job management
- Schedule viewing
- Task management
- VoIP calling (native SIP)
- Offline support
- Push notifications

## Configuration

Set your API URL in `src/config/api.ts`:

```typescript
export const API_URL = 'http://154.12.235.86'
```

## Development

```bash
# Start Metro bundler
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Building

### iOS
```bash
cd ios
xcodebuild -workspace TrimPro.xcworkspace -scheme TrimPro -configuration Release
```

### Android
```bash
cd android
./gradlew assembleRelease
```
