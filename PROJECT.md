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
