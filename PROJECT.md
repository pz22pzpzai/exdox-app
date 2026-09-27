# Exdox Android app

This repository is the Exdox React Native / Expo Android app. Source: `https://github.com/pz22pzpzai/exdox-app`. The website is `https://exdox.co.uk` (`https://github.com/pz22pzpzai/exdox`); the separate API is `https://hz2zkm6jkf.execute-api.eu-west-2.amazonaws.com/prod` (`https://github.com/pz22pzpzai/exdox-server`). The iPhone app is a separate project.

## Main files and commands

- `App.tsx`: app screens, including the mileage claim sheet.
- `src/services/`: authenticated API calls and workspace sync.
- `src/components/MileageRoutePreview.tsx`: postcode-based route map and selection in the mileage sheet.
- `app.json`: Expo package and version metadata; `android/`: native Android project.
- Use the bundled Node runtime in `../tools/node-v24.18.0-win-x64` for `npm` and TypeScript checks. Build Android from a short local folder such as `C:\b\exdox-route-20260927`, never from OneDrive. Set `ANDROID_HOME` and `ANDROID_SDK_ROOT` to the installed SDK and provide a valid `android/local.properties`.

## Mileage routing

The app calls the same authenticated `POST /mileage/route` API as the website, requesting a Mapbox static road-route preview. The API returns suggested and alternative driving distances and images, keeping the Mapbox access token on the server. The app automatically calculates when both UK postcodes are complete, lets the user choose **Use route**, and retains editable Total miles for the journey actually driven. This does not add turn-by-turn navigation, live tracking, or extra journey stops.

## Delivery and caveats

- A mobile source change requires a fresh verified phone-test APK on mounted Google Drive `G:\My Drive\Exdox Debug` and a source push to GitHub. APK build verification does not prove phone behaviour; the project owner tests on a device. Do not open emulators unless asked.
- Preserve unrelated working-tree files and avoid committing local build settings or artifacts.
- Never delete or move the keystore or signing details. Keep signing material in its existing protected location and never record its values here.

## Icon font packaging correction (2026-09-27)

- The first mileage phone-test APK was assembled by replacing only the JavaScript bundle in an older APK. Its Metro asset names did not match the older APK's Android resource names, so Ionicons appeared blank on the phone even though the route calculation worked. For future bundle-only patches, verify every referenced font/image resource matches the APK; otherwise build `assembleInstallableDebug` from the same staged source and assets.
- A full local build in `C:\b\exdox-route-20260927` packaged the bundle and 20 assets together. The APK contains the Ionicons font resource referenced by the generated build, passes `zipalign` and `apksigner`, and has the same debug signing certificate as the preceding test APK. It is `uk.co.exdox.mobile.debug`, native version `1.0.28-debug` / code `29`. At that test-build point, `app.json` still said `1.0.27` / code `28`; both version sources were aligned for the subsequent 1.0.29 Play release. No app behaviour source code was changed for this packaging correction.
- Replacement phone-test APK: `G:\My Drive\Exdox Debug\Exdox-1.0.28-debug-icons-fixed-road-mileage-2026-09-27.apk`, SHA-256 `358C693CFC44225CE72643580A2F5A842327ED99367CDA6BBE1463B9604CE13C`. Drive readback matched. No device was connected, so on-phone icon rendering still requires user verification.

## Google Play release 1.0.29 (2026-09-27)

- Play Console showed production 1.0.28 / code 29 live at 100% rollout and no unpublished changes before this release. Source commit `51ded55` aligned `app.json` and `android/app/build.gradle` to 1.0.29 / code 30; no behaviour source changed.
- Built `bundleRelease` from short local stage `C:\b\exdox-route-20260927` using the protected upload signing properties. The AAB contains the Hermes mileage bundle, matching Ionicons font, ReTrace mapping and native debug symbols. The upload certificate matched the preceding Play AAB. SHA-256 `1B61A3FF60F230C451B339FC20CC0DE26BB62424576B8214A28422B6E815108D`, 26,719,900 bytes. Mounted Drive copy and hash readback: `G:\My Drive\Exdox Play Releases\Exdox-1.0.29-code30-road-mileage-2026-09-27.aab`. Never delete or move keystores or signing details.
- Uploaded to Production as `1.0.29 (30) - Road mileage routes` at 100% rollout, with en-GB notes describing postcode road mileage. Play showed code 30 / version 1.0.29, mapping and native symbols, and no supported-device loss. Publishing overview showed **1 change sent for review** and **Changes in review**. Quick checks were still running; managed publishing was off. This is a submission, not proof of Google approval or public availability. Play Console publishing URL: `https://play.google.com/console/u/0/developers/8860801558607018930/app/4975323529690275681/publishing`.
