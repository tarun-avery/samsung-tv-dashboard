# Watchlist Companion

Pair an iPhone or another phone with the Dashboard and add films or series over home Wi-Fi. The Mac serves the pairing page and generates its QR code locally with Apple's Core Image. No internet account or catalogue is required.

<img src="phone-preview.png" alt="Phone form for adding a fictional series to a TV watchlist" width="300">

## Install on the Mac

From this directory, run `python3 install.py` while logged in. This requires macOS, Python 3.9 or later and the Xcode Command Line Tools. The installer prints the address to enter on the TV. The user LaunchAgent starts at login and restarts with a new LAN address after a network change. Reserve the Mac's local IPv4 address on the router if you use it as a permanent TV setting.

Open Add from phone in the TV guide. Scan the QR with the phone camera or visit the displayed address and enter the eight-digit code. Both devices must be able to reach the Mac on the same trusted network. Pairing uses local HTTP. Keep the Mac awake while adding titles.

A QR code or manual code can be claimed once within 15 minutes. The paired phone can submit more titles for one hour. Each TV has a separate queue. Reopening the phone page in the same browser tab keeps the phone session. Pending entries expire after seven days. The service stores its state under `~/Library/Application Support/Watchlist Companion/`. Its access logs omit request URLs and credentials.

## Verify or stop the service

Run `python3 -m unittest discover -p 'test_*.py'` from this folder to exercise the local API using temporary storage. To stop the service now, run:

```sh
launchctl bootout "gui/$(id -u)/local.watchlist-companion"
```

To also disable automatic startup, run `launchctl disable "gui/$(id -u)/local.watchlist-companion"`. Run the installer again to re-enable it.

## UK episode guide

Opening the TV's episode shelf sends a series title to this Mac. The helper looks up public [TVmaze](https://www.tvmaze.com/api) metadata, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Only an exact, unambiguous title is automatically selected. For a remake or translated title, choose the right year and channel on the TV. The helper caches lookups for four hours and labels results from an earlier check if a source is offline.

The main shelf accepts UK streaming premieres on the selected service, including matching regional alternate episode lists, and individually sourced UK release notices in `uk-release-notes.json`. Those notices cover only the named episodes. Worldwide air dates, broadcast TV premieres and general show availability do not verify a UK episode. They appear under **Other episode dates**. An upcoming date may change.

For wider UK subscription coverage, optionally place a [Watchmode API key](https://api.watchmode.com/docs) with GB region access in the file `watchmode.key` in the companion's private Application Support folder. The helper reads it locally and sends it only to Watchmode. It checks episode-level subscription offers for the selected UK service and labels the displayed date as the original air date when the UK premiere date is unknown. Paid-channel add-ons, purchases and rentals are excluded. A four-hour cache limits repeated requests. No key is needed to use the other guide features.
