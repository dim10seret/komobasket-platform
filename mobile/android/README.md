# KomoBasket Android

Native Android guest client in one `app` module. The production application ID and namespace are `gr.komobasket.app`.

## Toolchain

- Android Studio Rabbit 1 (2026.2.1), AGP 9.4.0, Gradle wrapper 9.6.0
- Gradle runtime: Android Studio bundled JBR 25; Android Java/Kotlin bytecode target: 17
- `minSdk 26`, `compileSdk 36`, `targetSdk 36`; SDK Build Tools 36.0.0
- AGP built-in Kotlin with Kotlin 2.3.21 on the build classpath; Compose compiler plugin uses the same Kotlin version

Set `JAVA_HOME` to Android Studio's bundled compatible JBR or a supported JDK. A PowerShell build can use:

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
.\gradlew.bat :app:assembleDebug
```

The Gradle wrapper is project-local. Run unit tests with `.\gradlew.bat :app:testDebugUnitTest`, lint with `.\gradlew.bat :app:lintDebug`, and unsigned release validation with `.\gradlew.bat :app:assembleRelease`.

## Current Guest/Public baseline

Verified on an Android 16 / API 36 emulator. Greek and English are supported. Guests select Season → public Organization (with search) → Competition → Θεσμός / Tournament. The active context stores `seasonId`, `organizationId`, `competitionId`, and `tournamentId` (the server-provided root phase ID). Home, Phases, Stats, Teams, Team Profile, Player Profile, and Official MVP are available. Home, Phases, and Stats offer a quick Θεσμός switch; More → Change Context lets guests select and apply a new four-part context.

## Architecture

Compose UI calls ViewModels, which call repositories. Repositories use the public HTTP API and DataStore. Public DTOs map to app models before reaching UI. Hilt provides one network client and the repositories. OkHttp has a bounded disk cache and follows server `Cache-Control`; the client adds no local TTL override. The API base URL is `https://komobasket.gr/`.

The first-run path is Welcome → Language → Guest → Season → Organization → Competition → Θεσμός → five-tab shell. Competition Detail supplies ordered `tournamentGroups`; the selected group's root phase ID is the persisted `tournamentId` alongside season, organization, and competition IDs. One group can be selected automatically; multiple groups require an explicit choice. Existing three-ID installs open the tournament gate without clearing onboarding. A saved root is checked against the current groups on process start, and an invalid root opens selection instead of choosing a different group. English and Greek resources are provided; AppCompat per-app locales apply the selected language.

The main tabs are Home, Phases, Stats, Teams, and More. Home, Phases, and Stats show the selected Θεσμός using one shared selector backed by `tournamentGroups`; a quick switch changes only `tournamentId` and returns to a fresh Home without stacking an old tournament. Home, Team Detail, and team games send `rootPhaseId`; phase selectors use only the selected group's server-provided `phaseIds`. Teams remain competition-wide. The current C1 MVP scope derives from the tournament-scoped Home response. A change of root within the same competition invalidates tournament-specific screen state. More → Change Context lets a guest choose Season → Organization → Competition → Θεσμός in a draft flow, then saves all four IDs in one DataStore update on Apply. Organization lists have local, accent-insensitive search; cancellation leaves the active context untouched. Pull to refresh uses the same cached HTTP client. Live cards hand trusted A3 web URLs to a browser. Coil loads public team logos without additional sports-data API calls.

## Deferred features

Google authentication, consumer accounts, Favorites, Polls, Fan MVP, Sponsors, Fantasy, Premium, Push notifications, Firebase, and native Match Center are not implemented.

The package tree separates `app`, `core`, `data`, and `feature` code within the single application module. Future detail routes should carry canonical IDs and load data through repositories.
