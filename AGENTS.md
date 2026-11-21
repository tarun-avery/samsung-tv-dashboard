# Samsung TV Dashboard

Read README.md before working on this remote-first Tizen web app. Runtime files live in app/. The TV guide uses tv-guide.js for menu navigation and watchlist.js for local storage and recommendations.

Use two-space indentation, camelCase and JavaScript compatible with the Tizen 3.0 browser. Reuse Dashboard's focus handling and launchEntry path. Preserve existing localStorage keys and the Tizen application ID across upgrades.

Keep public preview screenshots and app artwork generic. Use fictional watchlist data for examples. Keep signed widgets, certificates, local weather configuration, watch history and backups outside Git.

Run `node --test tests/watchlist.test.js` for watchlist changes. Check the browser preview with Playwright using arrows, Enter and Escape. Build with `./Build.command`. Check remote interactions on the target TV when available and record which checks ran on hardware. For a layout change, include a public-build screenshot with the pull request.

Use focused commits with imperative subjects describing the user-visible change.
