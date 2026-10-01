# Exdox Android app

This repository is the Exdox React Native / Expo Android app. Source: `https://github.com/pz22pzpzai/exdox-app`. The website is `https://exdox.co.uk` (`https://github.com/pz22pzpzai/exdox`); the separate API is `https://hz2zkm6jkf.execute-api.eu-west-2.amazonaws.com/prod` (`https://github.com/pz22pzpzai/exdox-server`). The iPhone app is a separate project.

## Main files and commands

- `App.tsx`: app screens, including the mileage claim sheet.
- `src/services/`: authenticated API calls and workspace sync.
- `src/components/MileageRoutePreview.tsx`: postcode-based route map and selection in the mileage sheet.
- `app.json`: Expo package and version metadata; `android/`: native Android project.
- Use the bundled Node runtime in `../tools/node-v24.18.0-win-x64` for `npm` and TypeScript checks. Build Android from a short local folder such as `C:\b\exdox-route-20260927`, never from OneDrive. Set `ANDROID_HOME` and `ANDROID_SDK_ROOT` to the installed SDK and provide a valid `android/local.properties`.

## Mileage routing

The app calls the same authenticated `POST /mileage/route` API as the website, requesting a Mapbox static road-route preview. The API returns driving distance and a map image, keeping the Mapbox access token on the server. The mileage claim sheet holds an ordered list of postcodes: Start, any number of added Stops, and Destination. Users can drag a row handle or use its up/down buttons to reorder all postcodes; the first and last rows become the new endpoints. Any postcode or order change clears the old miles immediately. The app recalculates when all postcodes are complete, sends `stops` in order, and records the full journey in the claim description. The requested miles remain editable for the actual journey. Two-postcode journeys can still offer alternatives; multi-stop journeys use one route through the supplied order. No turn-by-turn navigation or live tracking is included.

## Delivery and caveats

- A mobile source change requires a fresh verified phone-test APK on mounted Google Drive `G:\My Drive\Exdox Debug` and a source push to GitHub. APK build verification does not prove phone behaviour; the project owner tests on a device. Do not open emulators unless asked.
- Preserve unrelated working-tree files and avoid committing local build settings or artifacts.
- Never delete or move the keystore or signing details. Keep signing material in its existing protected location and never record its values here.

## Admin purchase decisions (2026-10-01)

- The website admin can reject a Cost receipt in Review; deleting an unreviewed Cost receipt also records a decision. The server stores a vendor and amount snapshot scoped to the uploader, and Android fetches it at sign-in, on foreground, and every 60 seconds while active. These are in-app notices, not operating-system push alerts.
- Purchases retains a rejected or admin-deleted row and read-only detail until the uploader taps Delete. Deleting a rejected row also soft-deletes its receipt; deleting an admin-deleted row dismisses its decision. A restored admin-deleted receipt returns on the next decision refresh and workspace sync. The iPhone app was outside this change.
- Final phone-test `assembleInstallableDebug` built from local `C:\b\exdox-route-20260927`. TypeScript passed; AAPT, zipalign, apksigner, bundled Hermes asset matching, and 19 packaged TTF assets checked. Package `uk.co.exdox.mobile.debug`, version `1.0.29-debug` / code `30`. Mounted Drive copy and SHA-256 readback matched: `G:\My Drive\Exdox Debug\Exdox-1.0.29-debug-admin-purchase-notifications-2026-10-01.apk`, `DCEA728CA765A148645640ED17A8C1339C80A59402A9D2314E1828EF584C9FB9`. No emulator or phone launch was performed. Never delete or move signing material.
- Bell repair: only admin deletion/rejection decisions count in the bell; processing and awaiting-review purchases do not. Decision sync starts immediately after sign-in and runs independently of full Cost/Sales/Claims sync. Android OS alerts were excluded at the owner's request and still require separate push setup.
- Bell phone-test APK built from local `C:\b\exdox-route-20260927`: `G:\My Drive\Exdox Debug\Exdox-1.0.29-debug-bell-admin-decisions-fixed-2026-10-01.apk`, SHA-256 `FD35FCFCEA34A4528A4658B0BB232569D574ECD6F0CFF68A5460CE6E9739E08E`. AAPT package/version, zipalign, apksigner, generated/embedded bundle match, 19 TTF assets, and mounted Drive readback passed. No phone or emulator launch was performed. Never delete or move signing material.

## Android workspace country (2026-10-01)

- The app reads the organisation country saved at website signup from `GET /settings`. Legacy local settings default to GB. Business admins can change country in Android Settings; the app sends the country, matching base currency, local tax review default, and regional mileage default to the existing settings API. This changes the shared workspace for all users, not just one device. UK choices and postcode mileage remain the GB path.
- `src/region.ts` mirrors the website's supported GB, US, AU, CA, and EUR-country list and tax review choices. These are review prompts, not automatic tax calculation or filing. `src/services/documentExtraction.ts` no longer forces `en-GB`; the existing API chooses the OCR locale from the organisation country. Unreadable/manual drafts use the workspace base currency.
- Non-UK Android mileage uses manually entered locations and the workspace currency. The postcode route preview remains UK-only. The server's legacy mileage endpoint still names its location fields `startPostcode` and `endPostcode`; they accept the entered location text. The Android app has no native country-specific tax return or filing workflow.
- Phone-test `assembleInstallableDebug` built successfully from local `C:\b\exdox-route-20260927` with bundled Node and SDK. TypeScript and `git diff --check` passed. The APK is package `uk.co.exdox.mobile.debug`, version `1.0.29-debug` / code `30`; AAPT, zipalign, apksigner, embedded-bundle comparison, and packaged font checks passed. Mounted Drive copy `G:\My Drive\Exdox Debug\Exdox-1.0.29-debug-workspace-countries-2026-10-01.apk` has SHA-256 `DDFA009A9C25F15F0C525563F46BFCCEAA01C1FDBCB5E51B60D982720231D7E0` and matched the local file on readback. No emulator or physical-device behaviour was tested. Never delete or move a keystore or signing details.

## Admin purchase decisions in Android (2026-10-01)

- `GET /receipts?decisions_only=true` supplies uploader-specific decisions for an unreviewed Cost that an admin deleted or rejected. Android syncs them on login and refresh, polls while active every minute, and refreshes on foreground. The notification panel shows a vendor-specific message; Purchases shows **Deleted by admin** or **Rejected by admin** until the uploader deletes the item. Deleting dismisses the decision on the server; for a rejected receipt it also moves the receipt to the existing recycle bin. Decision rows are read-only and cannot enter claims or financial totals. The API change must deploy before this Android build is used. No OS push notification service was added. Never delete or move the keystore or signing details.

## Google Play feature graphic correction (2026-09-28)

- `play-store-assets/feature-graphic-1024x500-fixed.png` is the 1024 × 500 replacement for a feature graphic whose headline clipped “Exdox” in Google Ads previews. The corrected image keeps the approved Exdox logo and fits the complete “Capture receipts with Exdox” headline inside the image. SHA-256: `6F598AB90645833068026A5503F21075BE227CE1FEFD03E2BFFC702A6EE1A02B`.
- The corrected asset was saved to the en-GB default Play listing and submitted for review. Play Console showed **Changes in review** with quick checks running; this does not confirm public availability. Google Ads may continue showing the previous feature graphic until Google approves and refreshes the listing. This is a store graphic change, not an Android app build; no APK is needed. Never delete or move keystores or signing details.

## Icon font packaging correction (2026-09-27)

- The first mileage phone-test APK was assembled by replacing only the JavaScript bundle in an older APK. Its Metro asset names did not match the older APK's Android resource names, so Ionicons appeared blank on the phone even though the route calculation worked. For future bundle-only patches, verify every referenced font/image resource matches the APK; otherwise build `assembleInstallableDebug` from the same staged source and assets.
- A full local build in `C:\b\exdox-route-20260927` packaged the bundle and 20 assets together. The APK contains the Ionicons font resource referenced by the generated build, passes `zipalign` and `apksigner`, and has the same debug signing certificate as the preceding test APK. It is `uk.co.exdox.mobile.debug`, native version `1.0.28-debug` / code `29`. At that test-build point, `app.json` still said `1.0.27` / code `28`; both version sources were aligned for the subsequent 1.0.29 Play release. No app behaviour source code was changed for this packaging correction.
- Replacement phone-test APK: `G:\My Drive\Exdox Debug\Exdox-1.0.28-debug-icons-fixed-road-mileage-2026-09-27.apk`, SHA-256 `358C693CFC44225CE72643580A2F5A842327ED99367CDA6BBE1463B9604CE13C`. Drive readback matched. No device was connected, so on-phone icon rendering still requires user verification.

## Google Play release 1.0.29 (2026-09-27)

- Play Console showed production 1.0.28 / code 29 live at 100% rollout and no unpublished changes before this release. Source commit `51ded55` aligned `app.json` and `android/app/build.gradle` to 1.0.29 / code 30; no behaviour source changed.
- Built `bundleRelease` from short local stage `C:\b\exdox-route-20260927` using the protected upload signing properties. The AAB contains the Hermes mileage bundle, matching Ionicons font, ReTrace mapping and native debug symbols. The upload certificate matched the preceding Play AAB. SHA-256 `1B61A3FF60F230C451B339FC20CC0DE26BB62424576B8214A28422B6E815108D`, 26,719,900 bytes. Mounted Drive copy and hash readback: `G:\My Drive\Exdox Play Releases\Exdox-1.0.29-code30-road-mileage-2026-09-27.aab`. Never delete or move keystores or signing details.
- Uploaded to Production as `1.0.29 (30) - Road mileage routes` at 100% rollout, with en-GB notes describing postcode road mileage. Play showed code 30 / version 1.0.29, mapping and native symbols, and no supported-device loss. Publishing overview showed **1 change sent for review** and **Changes in review**. Quick checks were still running; managed publishing was off. This is a submission, not proof of Google approval or public availability. Play Console publishing URL: `https://play.google.com/console/u/0/developers/8860801558607018930/app/4975323529690275681/publishing`.

## Multiple postcode stop debug APK (2026-09-27)

- App source was pushed on `main` through commit `0090d32`. The matching API source was pushed through commit `72ed1f4`. The user checks deployment; do not inspect the website or deployment workflow after pushing.
- Final `assembleInstallableDebug` from `C:\b\exdox-route-20260927` succeeded. Package `uk.co.exdox.mobile.debug`, version `1.0.29-debug`, code `30`. AAPT, zipalign, apksigner, Hermes bundle, and bundled Ionicons font checks passed. The embedded bundle matched Gradle's generated bundle.
- Phone-test APK: `G:\My Drive\Exdox Debug\Exdox-1.0.29-debug-multiple-postcode-stops-2026-09-27.apk`, 55,073,807 bytes, SHA-256 `200C719B54464EE355A5F13CDADBC53F0C9411E26EC440DF966FA4950B154E8E`. Mounted Drive readback hash matched. No emulator or physical phone launch was performed; the owner should test drag, arrow reorder, route calculation, and claim review on a phone.
- This debug build is separate from the already submitted Play release 1.0.29/code 30. Never delete or move a keystore or signing details.
