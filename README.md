# exdox

exdox is a React Native expenses app built with Expo and TypeScript.

## What it does

- Capture new receipts and invoices with the camera
- Import images or PDF files from the phone
- Process receipts and invoices through a secure backend OCR proxy
- Separate receipt and invoice workflows
- Group receipts into draft expense claims
- Persist everything on-device with no bank feed or accounting integration

## Main files

- `App.tsx` contains the app shell and screen flow
- `src/components` contains reusable cards
- `src/data/seed.ts` defines the blank first-launch state
- `src/utils/storage.ts` handles local persistence
- `src/utils/documents.ts` creates imported draft documents
- `src/services/documentExtraction.ts` uploads files to the secure backend OCR proxy
- `src/utils/uploadAsset.ts` compresses mobile image uploads before sending them

## Backend OCR proxy

The secure OCR proxy lives in `../server`.

1. Copy `server/.env.example` to `server/.env`
2. Set `OPENAI_API_KEY` on the server environment
3. Install server dependencies with `npm install`
4. Start the API with `npm run dev` for development or `npm run build && npm run start` for production

The mobile app reads `EXPO_PUBLIC_EXPENSES_API_URL` if you want to override the default backend URL at build time.

## Run locally

1. Install dependencies with `npm install`
2. Start the project with `npm start`
3. Run Android with `npm run android`

## Build APK

Use `npm run android:apk`

The arm64 release APK is created at:

`android/app/build/outputs/apk/release/app-release.apk`
