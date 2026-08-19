# subscription_app

## Development container

Open this repository in VS Code with the Dev Containers extension and choose **Reopen in Container**. The container includes Flutter, the Android SDK, and the Flutter/Dart VS Code extension. On first creation, `flutter doctor` runs to show the installed toolchain and any host-specific warnings.

Android builds and tests can run from the container. iOS builds cannot run in this Linux container because Apple requires Xcode on macOS; use a macOS development machine or CI runner for iOS builds and signing.
