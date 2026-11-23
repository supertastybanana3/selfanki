日本語: [README.md](README.md)

# selfanki (暗記)

A web app that copies the look and behavior of AnkiMobile 25.09. You move your cards over from Anki on your computer, host them on your own Cloudflare account (free tier), and use them in the browser on an iPad, iPhone, Android device or computer. You can sync with Anki on your computer through an Anki add-on (included).

- By default it aims to behave like AnkiMobile 25.09. Interval calculation (with FSRS on, and with FSRS off = SM-2; including learning steps, fuzz and load balancing), the order cards are shown in (including the order options, sibling burying and limits), and the day boundary (next day starts at, time zone) were checked against Anki 25.09.4 and match. Syncing also happens only when you press "Sync", as in the official app. Statistics, deck options and the congratulations screen use Anki's own screens as they are
- The FSRS calculations in deck options (parameter optimization, health check, evaluation, simulator, optimal retention, and the workload multiplier when you change the desired retention) are a JavaScript port of Anki 25.09.4's calculations (fsrs-rs 5.1.0 and rslib) and run on your device (in a Web Worker; the simulation is split across several workers). The recalculation of memory states when you save, and the rescheduling of due dates under "Also reschedule existing cards when parameters change", work the same way. Depending on your device, it can take longer than Anki
- Features that are not yet reproduced are shown dimmed and can't be tapped
- Some features the official app doesn't have are included as options. You choose whether to include them at install time. If you don't, they don't appear in the app at all
  - Ink: write directly on a card with Apple Pencil (also works on vertically written cards). This is separate from the official app's handwriting pad. The design of the toolbar and so on is meant to be made by each user; the author's design is included as a sample in `app/designs/sample/`. You can use the sample as it is ([How to make a design](app/designs/README.md))
  - Squeeze and double-tap: if you include Ink and also the iPad/iPhone shell ([Step 7](#step-7-the-ipadiphone-shell-optional)), the Apple Pencil Pro squeeze and double-tap work (in the sample design, eraser and undo one stroke). In the shell, keyboard shortcuts work even while a Japanese input method is active
  - Auto sync: sends your answers a few seconds after you answer, and also syncs when you open or return to the app
- The display language can be chosen from the languages Anki has. Anki's own screens use Anki's translation. For the app's own text, the Anki translation is used where one exists, and English otherwise
- Not affiliated with Ankitects (the authors of Anki and AnkiMobile)
- No warranty. The author is not responsible if using this corrupts or loses your data, or throws your study records off. Make an Anki backup before you start, and before write-back (Step 8)

| What you want to do | Where to look | This repository | Sideload |
|---|---|---|---|
| Just roll AnkiMobile back to the look before 26.10 | [A](#a-downgrade-ankimobile) | Not needed | Not needed |
| Roll Anki (desktop) back to an older version | [B](#b-downgrade-anki-desktop) | Not needed | Not needed |
| Roll AnkiDroid back to an older version | [C](#c-downgrade-ankidroid) | Not needed | Not needed |
| Use this app | [Using this app](#using-this-app) | Needed | Not needed (works in the browser) |
| Also use squeeze and keyboard shortcuts on an iPad/iPhone | [Step 7](#step-7-the-ipadiphone-shell-optional) | Needed | Needed |

If you only want the old UI back, you need neither this app nor sideloading. Just roll AnkiMobile itself back as described in A (A to C are at the end of this README).

---

## Using this app

### How it works

```
 Computer (Anki, and the tools in this repository)
   │ 1. From a copy of your Anki collection, export card fronts/backs (as rendered by Anki), decks, settings and review logs
   │ 2. Upload to Cloudflare (only devices that hold the passphrase can see it)
   ▼
 Cloudflare (your own account, free tier)
   Pages … the app and the card contents
   D1    … your answer records
   ▲                                     │
   │ Answer cards (even offline; send     │ 3. Sync with Anki (optional; add-on): writes your answers to Anki,
   │ them with "Sync")                    │    and sends back to this app what you studied in Anki (AnkiMobile etc.)
 Device (iPad, iPhone, Android, computer browser, or the iOS shell app)
```

What is stored on Cloudflare: card fronts and backs, all note fields (for search), tags, deck names, note type CSS and templates, images and audio, study records, the contents of notes added, edited or deleted on a device, and images and audio imported on a device (.apkg). None of it can be viewed without the passphrase. The same data also stays on your device. To remove it from a device, clear the site data in that browser (for the shell app, delete the app).

The HTML of a card is displayed with `<script>`, attributes such as `onerror=`, and `javascript:` URLs removed.

What it can't do:
- Adding, deleting or renaming note types, note type options (LaTeX and so on), and detailed field settings (font, sticky, description and so on). Do these in Anki and then upload again (Step 9). Card templates and fields, and the browser's "Change Note Type", can be done on the device ([Fixing and changing note types](#fixing-and-changing-note-types)). Adding, editing and deleting notes can also be done on the device ([Adding, editing and deleting notes on a device](#adding-editing-and-deleting-notes-on-a-device))
- Cards that depend on JavaScript in the template don't work (scripts are removed). However, type-in-the-answer cards (`{{type:…}}`) and image occlusion work the same as in Anki
- "Download Shared Deck" under "Add/Export" only opens the AnkiWeb shared decks page (downloading needs an AnkiWeb login, so this app can't fetch it). Download it in Safari or similar, then load it with "Import from iTunes" ([Exporting and importing](#exporting-and-importing-apkg-colpkg)). You can also create, rename and delete decks ([Creating, renaming and deleting decks](#creating-renaming-and-deleting-decks))
- Filtered decks made on a device are not created in Anki (they sync between devices). The results of answering in a device's filtered deck (intervals, review logs) go into Anki just as if you had answered normally
- It does not sync directly with AnkiWeb. Exchange with Anki goes through Anki on your computer (Step 8; syncing is done by the Anki add-on)
- The "?" button (ask an AI) needs a separate relay server. It isn't included in this repository, so the button doesn't appear unless you set one up
- Answers that haven't been synced reach neither the server nor Anki on your computer. By default, press "Sync" below after answering

### Filtered decks

Create them from "Filtered / Cram" in the gear menu (defaults are filled in from the current deck; the fields are the same as Anki's filtered decks: search, limit, order to pull cards, the second filter, whether to reschedule cards based on my answers, the "Again", "Hard" and "Good" seconds used when not rescheduling, and create even if empty). They appear in blue in the list.

- Gear menu while a filtered deck is open: "Options" returns to this screen to edit it (the "Rebuild" at the top right rebuilds with the edited conditions), "Rebuild", "Empty". You can also open it from the "›" at the right of the list. "Delete Deck" at the very bottom deletes it, and its cards return to their original decks
- The four custom study options "Review forgotten cards", "Review ahead", "Preview new cards" and "Study by card state or tag" create a filtered deck called "Custom Study Session" (rebuilt if it already exists), as in Anki. Tags are picked from a list (include/exclude; remembered per deck)
- Which cards go in, their order, the order shown inside, and what happens after you answer (a card that becomes a review goes back to its original deck; one still in learning stays; in decks that don't reschedule, it's a preview) are the same as Anki 25.09.4 (see "What was verified" below)
- The definition is stored as `fdeck:<id>` in the server's conf table, and the mark of which cards are inside is stored in the card state (`data.flt`) and syncs to other devices. Nothing is written to Anki
- A filtered deck made in Anki appears with the definition and contents at the time you uploaded (Step 9). Rebuilding, emptying or deleting on a device leaves the Anki side as it is
- A card answered or moved in Anki follows its location in Anki (it leaves the device's filtered deck)

### Adding by URL (AnkiMobile URL scheme)

What AnkiMobile's `anki://x-callback-url/addnote?…`, `search?query=…` and `sync` do is accepted by appending `#x-callback-url/…` to the app's URL (the parameters are as in the "URL Schemes" chapter of the AnkiMobile manual). Example:

```
https://<your-site>/app/#x-callback-url/addnote?type=Basic&deck=Default&fldFront=front%20text&fldBack=back%20text&tags=a%20b
```

- A note added this way is treated like a note added on the device (it goes into Anki on sync). If a note of the same note type with the same first field already exists, it isn't added unless `dupes=1` is given
- URLs to images and audio (ones ending in a file extension) are fetched through your own server (`functions/api/fetch.js`) and made into files (because this app's page can only communicate with your own site)
- An app placed on the iPhone/iPad home screen can't receive URLs opened from Shortcuts and the like (they open in Safari). The shell (Step 7) also doesn't yet accept schemes such as `anki://`. `infoForAdding` isn't supported

### Notes on syncing

- If you answer the same card in two places without syncing (another device running this app, Anki, AnkiMobile and so on), the newer answer is kept for each card, and the result of the other answer is lost (the log rows are kept for both). Which is newer is decided by each device's clock, so if a clock is off, the older answer may win
- Changes that aren't answers (hide, suspend, flag, and recalculation after changing options in Anki) do not overwrite a newer answer the other side doesn't know about. For example, if a device that hasn't synced yet buries a card as a sibling that you answered in Anki, the due date from the answer in Anki stays (the bury is discarded)
- An answer that hasn't been synced exists only inside that device. Sync before switching devices and before clearing browser data. Safari on iPhone/iPad may delete the stored data of a site you haven't used for about 7 days (sites added to the home screen are exempt). Add it to the home screen and sync often
- Answers made on another device show up here after that device syncs and then you sync here
- Answers reach Anki on your computer when you do Step 8 (syncing with Anki). Exchange with AnkiMobile and AnkiWeb goes through Anki on your computer
- After write-back, if Anki asks about a one-way sync with AnkiWeb (upload or download), check carefully which side to keep before choosing. If you choose wrong, either the data you wrote back or the AnkiWeb side is lost
- For answers you undid in this app, the part that has already been written back to Anki is not removed from Anki. Per-deck limits and global settings are not written back to Anki

- As in Anki, the day boundary is decided by the collection's "next day starts at" and the time zone of the device you're using now. If devices are in different time zones, each has a different idea of "today" (the same as in the official app)

### For AnkiDroid users

- This app also works in Chrome on Android (add it to the home screen; Step 6-1). Its look and controls follow AnkiMobile (the Anki for iPhone/iPad), not AnkiDroid
- Exchange with Anki **goes through Anki on your computer**. It does not sync directly with AnkiDroid. What you studied in AnkiDroid arrives in this order:
  1. Sync in AnkiDroid (to AnkiWeb)
  2. Sync in Anki on your computer (pull from AnkiWeb)
  3. Sync with the "selfanki Sync" add-on (Step 8-A. If you set the add-on's `after_anki_sync` to `true`, it runs right after 2)
  4. To bring what you studied in selfanki back to AnkiDroid, after 3 sync again in Anki on your computer, then sync in AnkiDroid
- Anki on your computer is also needed for the first transfer of cards (Step 5). **If you don't have Anki on a computer, you can't currently exchange data with Anki**
- If you study the same card in both AnkiDroid and this app without syncing, the newer answer is kept for each card ("Notes on syncing")
- To compare calculations with an older AnkiDroid, see "C. Downgrade AnkiDroid"

### Requirements

| Item | Condition | Combination tested |
|---|---|---|
| Computer | Windows 10/11, Mac or Linux. You use a command-line screen (terminal) | Windows 11 (Ubuntu on WSL, and Windows Python) |
| Anki (desktop) | Contains the cards you want to move | A collection in the 25.09.4 format |
| Python | 3.9 or later. 3.12 or 3.14 recommended | 3.12, 3.14 |
| Node.js | 20 or later (LTS) | 22, 24 |
| Cloudflare account | Free. <https://dash.cloudflare.com/sign-up> | — |
| If you do Step 7 | A GitHub account, an Apple ID, iOS/iPadOS 17.5 or later | iPadOS 27 |
| If you do Step 8 | Anki 25.09 or later (add-on in 8-A), or AnkiConnect (8-B) | Anki 25.9.4 |

Cloudflare free-tier limits ([Pages](https://developers.cloudflare.com/pages/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/pricing/)): one site can hold up to 20,000 files, each up to 25 MiB. D1 is up to 500 MB per database, with up to 100,000 rows written per day. Each image or audio file counts as one file. The app itself and so on use a few hundred files, so if you have more than 19,000 images and audio files, leave out the decks you don't use (`exclude_top_decks` in Step 2).

### The shortest path

1. First create a free Cloudflare account and finish the email verification (<https://dash.cloudflare.com/sign-up>). Close Anki
2. Install Python and Node.js as in [Step 1](#step-1-python-and-nodejs)
3. Download this repository (on GitHub: "Code" → "Download ZIP" → extract. It's safest to put it somewhere without Japanese characters in the path, such as `C:\selfanki`)
4. On Windows, double-click `setup_windows.bat` (if "Windows protected your PC" appears, click "More info" → "Run anyway"). On Mac/Linux, go to the extracted folder in a terminal and run `bash setup.sh`
5. Answer the questions
   - Anki profile (automatic if there is only one)
   - Project name (press Enter to let it choose)
   - Decks to exclude (choose by number; press Enter to move everything)
   - Display language
   - Whether to include features the official app doesn't have (Ink: don't use / sample design / your own design; Sync: as in the official app / Auto sync). If unsure, press Enter (as in the official app)
   - Log in to Cloudflare (a browser opens; log in and click "Allow")
6. Enter the URL and 6-digit pairing code shown at the end on the device you want to use ([Step 6](#step-6-connect-your-devices)). Right after creation, it can take a few minutes before the site is reachable

The setup tools and the Anki add-on show English unless your system or Anki language is Japanese. Set the environment variable `SELFANKI_LANG=en` or `SELFANKI_LANG=ja` to force one.

If it stops partway, fix it as described under `[Stopped]` and run the same thing again. Steps already done are skipped and it continues from where it stopped. If you only want to use it in a browser, you're done here. Steps 7 to 9 are only for those who need them.

From the second time on, running the same thing (`setup_windows.bat` or `bash setup.sh`) lets you choose what to do: add a device (shows a code) / upload cards you added or changed in Anki / write back to Anki (Dry run or the real thing) / checkup / build the Anki add-on.

What follows is how to do the same things by hand, one at a time.

### Rules for AI agents

An AI that works by reading this README follows these rules.

1. Proceed through the steps in numeric order. Run the "Check" for each step, and if the result differs from what is written, don't go on; see [Troubleshooting](#troubleshooting). If it isn't covered there, consult the human. When you do, mask any 6-digit pairing code, URL or path in the output
2. Don't even read the passphrase (the file named by `token_file` in `config.json`). Don't put its contents on screen, in chat, in logs, in commits or in URLs. To connect a device, use the code from `tools/pair_code.py`
3. Where it says `python`, use the python of the virtual environment made in Step 1 (`.venv\Scripts\python` on Windows, `.venv/bin/python` on Mac/Linux). Don't `pip install` into the system Python
4. Don't commit `config.json`, `cloud/state/`, `cloud/site/`, `cloud/media/` or `*.anki2`. Check with `git status` before `git add`
5. Don't open or modify the real `collection.anki2` (the tools open only a copy). Operations that delete Anki data, "Downgrade & Quit", and syncing with AnkiWeb are done only when the human asks
6. Things the human decides: `project_name`, the decks to exclude (`exclude_top_decks`), the language (`language`), whether to include features the official app doesn't have (`extras`; don't include them without asking), logging in to Cloudflare, GitHub and Apple ID (the browser and password entry are for the human), and operations on the iPhone/iPad screen
7. Don't pass `--rebase` to `tools/build_site.py`
8. Don't delete Cloudflare projects or databases
9. Step 8 (syncing with Anki) is done only if the human wants it. First take an Anki backup, show the human the result of a dry run (the add-on's "Dry run" or `--dry`), and only then do the real run
10. If you can't answer the interactive questions, write `config.json` as in Step 2 and then run each tool (if it is filled in, `tools/setup.py` asks nothing)
11. If unsure, run `python tools/doctor.py` and follow the `→` on the `[NG]` lines

---

### Step 1: Python and Node.js

- Python: <https://www.python.org/downloads/>. On Windows, check "Add python.exe to PATH" on the first screen of the installer
- Node.js: the LTS from <https://nodejs.org/>

Check (in a newly opened terminal): `python --version` (on Windows `py --version`) is 3.9 or later, and `node --version` is v20 or later.

Create a virtual environment and install anki (in the repository folder. This is done automatically if you use `setup_windows.bat` or `setup.sh`):

| | Windows | Mac/Linux |
|---|---|---|
| Create | `py -3 -m venv .venv` | `python3 -m venv .venv` |
| Install anki | `.venv\Scripts\python -m pip install anki==25.9.4` | `.venv/bin/python -m pip install anki==25.9.4` |

In this README, `python` means the python of this virtual environment. Read it as `.venv\Scripts\python` on Windows and `.venv/bin/python` on Mac/Linux.

Check: `python -c "from anki.buildinfo import version; print(version)"` prints `25.09.4`.

### Step 2: Config file

Copy `config.example.json` to a file named `config.json` and fill it in. You can also run `python tools/setup.py --config-only` and answer questions to create it.

```json
{
  "project_name": "myanki-7f3a",
  "site_url": "",
  "anki_collection": "C:/Users/NAME/AppData/Roaming/Anki2/User 1/collection.anki2",
  "anki_media_dir": "C:/Users/NAME/AppData/Roaming/Anki2/User 1/collection.media",
  "language": "ja_JP",
  "ankiconnect_url": "http://127.0.0.1:8765",
  "ankiweb_sync": false,
  "exclude_top_decks": [],
  "exclude_underscore_decks": false,
  "token_file": "~/.config/selfanki/token",
  "extras": {
    "pen_design": "",
    "auto_sync": false
  }
}
```

| Key | Meaning |
|---|---|
| `project_name` | The name of the project created on Cloudflare. Lowercase letters, digits and hyphens only, 2 to 58 characters, starting and ending with a lowercase letter or digit. The app's address is normally `https://<this name>.pages.dev` (if the name is taken, characters are appended; the actual address is shown in Step 4). Pick a name that is hard to guess. Don't use the example `myanki-7f3a` as is |
| `site_url` | Leave empty (it is filled in at Step 4) |
| `anki_collection` | Your Anki collection. On Windows, type `%APPDATA%\Anki2` in the Explorer address bar to open the folder; inside it, in the folder named after your profile (`User 1` and so on), it is `collection.anki2`. On Mac it is `~/Library/Application Support/Anki2/<profile name>/collection.anki2`, on Linux `~/.local/share/Anki2/<profile name>/collection.anki2` ([official explanation](https://docs.ankiweb.net/manual/files)). If you use this from WSL, write the Windows location as `/mnt/c/Users/…`. Use `/` as the path separator (or `\\` for `\`) |
| `anki_media_dir` | The `collection.media` in the same folder. If you leave it empty, Anki is launched at upload time and the media is fetched through AnkiConnect |
| `language` | The display language. An Anki language code (`ja_JP`, `en_US`, `de_DE`, `zh_CN` and so on; you can choose from a list in `tools/setup.py`) |
| `ankiconnect_url` | Used in Step 8. Normally leave as is |
| `ankiweb_sync` | In Step 8, whether to sync Anki with AnkiWeb before and after write-back. `true` or `false` (don't quote it as `"false"`) |
| `exclude_top_decks` | Names of top-level decks (the leftmost part before `::`) not to move. `[]` to move everything |
| `exclude_underscore_decks` | If `true`, decks whose names start with `_` are not moved |
| `token_file` | The file where the passphrase is kept. Keep it outside the repository (the default is fine) |
| `extras.pen_design` | The design for Ink (a feature the official app doesn't have). `""` = don't use (default), `"sample"` = the author's sample design, or the name of a folder inside `app/designs/` for one you made yourself ([how to make one](app/designs/README.md)) |
| `extras.auto_sync` | `false` = only when you press "Sync" (default, as in the official app), `true` = sync automatically each time you answer |
| `cloudflare_account_id` | You don't need to write it. Write it only if you have several Cloudflare accounts and are told to choose |
| `d1_location` | You don't need to write it. Your preferred region for D1 (`apac`, `wnam` and so on). Takes effect only the first time, in Step 4 |
| `lock_command` | You don't need to write it. A command (an array) called with `on` or `off` appended before and after write-back. Use it if you want to keep other tools from touching Anki at the same time |

Check: with `python tools/doctor.py`, `config.json`, `Anki collection` and `Media folder` show `[OK]`.

### Step 3: MathJax and other vendor files

```
python tools/fetch_vendor.py
```

Check: `Installed: …mathjax 106 files`, `Installed: …sqljs 3 files` and `Installed: …fzstd 2 files` appear (from the second run on, `… is already installed`). sql.js and fzstd are used to export and import .apkg and .colpkg. Even if you finished Step 3 with an earlier version, run it again after upgrading (without it, Step 5 stops).

### Step 4: Cloudflare setup (first time only)

1. Log in. A browser opens; the human logs in and presses "Allow"
   ```
   npx --yes wrangler@4.165.0 login
   ```
2. Create the project
   ```
   python tools/setup_cloud.py
   ```
   This creates a passphrase and saves it to `token_file` (it is not displayed), creates the D1 database, `cloud/wrangler.toml`, the tables and the Pages project, puts the passphrase into the Pages secret `SA_TOKEN`, and fills in `site_url` in `config.json`

Check: `[1/6]` to `[6/6]` appear, and the last line says `Your site is https://….pages.dev`.

If a database or project with the same name already exists, it is used. Don't use the same name as one made for a different collection.

### Step 5: Move from Anki and upload

1. If you use AnkiWeb, sync first. While the move is running, don't study or edit in Anki (ideally close it)
2. Export. This doesn't touch the real collection; it makes a copy in `cloud/state/snap/` and reads that
   ```
   python tools/export_anki.py
   ```
   Check: `cards <count>` and `per top-level deck [...]` appear, and `missing 0`. If it isn't 0, that many images/audio files are missing from Anki's folder (in Anki, "Tools" → "Check Media")
3. Build and upload (the first time takes a few minutes)
   ```
   python tools/build_site.py --deploy
   ```
   Check: `Built the site: …` and `Uploaded to Pages … Deployment complete!`. Then with `python tools/doctor.py`, `Content is hidden without the passphrase (401)` and `The manifest can be read with the passphrase (200)` show `[OK]`

For a few minutes after creation, the site may be unreachable.

### Step 6: Connect your devices

1. On the computer, show a code (valid 15 minutes, single use)
   ```
   python tools/pair_code.py
   ```
2. Open the shown URL (`…/pair`) on the device you want to use and enter the 6-digit pairing code (including a leading 0)
   - iPhone/iPad (Safari): before entering the code, tap the Share button → "Add to Home Screen", then open it from the home screen icon and enter the code there (the home screen app and Safari have separate storage)
   - Android (Chrome): enter the code, then ︙ → "Add to Home screen"
   - Computer: you can use it in the browser as is
3. Show a new code for each device. If a code is entered wrongly 5 times, all outstanding codes are deleted

Check: the deck list appears and you can answer cards. After answering, pressing "Sync" below sends the records to the server (only the first time you open it on a device does it sync automatically).

Once you have opened it, it also opens offline afterwards. However, until all images and audio have been fetched, some of them won't show offline.

Ink and Auto sync appear only if you included them at install time (`extras` in `config.json`). To include them later, edit `extras` and run `python tools/build_site.py --deploy`. To turn one off per device, use "Settings" → "Features specific to this app".

#### 6-1. Add to the home screen (without the shell)

Without sideloading (Step 7), you can use it like an app by adding it to the home screen. For ordinary use this is enough.

- **iPhone/iPad (Safari)**: open the site → Share button → "Add to Home Screen" → open it from the home screen icon and enter the 6-digit code there
- **Android (Chrome)**: open the site and enter the code → ︙ → "Add to Home screen" (or "Install app")
- **Computer (Chrome, Edge)**: "Install" to the right of the address bar makes it a window-only app. You can also keep using it in a browser tab

Easy places to trip:

- **On iPhone/iPad, Safari and the home screen app have separate storage.** Even if you connected in Safari by entering the code, opening from the home screen icon asks for a code again. Enter the code inside the home screen app
- **Deleting the icon also deletes that device's data.** Answers that haven't been synced are lost too, so press "Sync" before deleting it
- **Features that exist only in the shell aren't available**: Apple Pencil Pro squeeze and double-tap, keyboard shortcuts while a Japanese input method is active, and playing sound in silent mode (the list in Step 7)
- **The badge count on the icon** (Settings > Study > Notifications) can be shown only when it was added to the home screen on iOS 16.4 or later (notification permission is needed)
- The form added to the home screen from the public version hasn't been fully tried on a real iPad (the author uses the shell). If something doesn't work, please let us know

### Step 7: The iPad/iPhone shell (optional)

It works in a browser, but on iOS a web page can't do the following. Only if you need them, install a thin native shell (Swift; the content is the same web app). All of these are features the official app doesn't have.

- Apple Pencil Pro squeeze and double-tap (works only if you included an Ink design at install time)
- Keyboard shortcuts while a Japanese input method is active
- Playing card audio even in silent mode, without stopping music from other apps (in a browser the audio is made to play over other audio, but this hasn't been checked in Safari on iOS)

Prerequisites: iOS/iPadOS 17.5 or later. It is installed signed with your own Apple ID, so you reinstall every 7 days (a rule of free Apple IDs; up to 3 can be installed at once, and up to 10 App IDs can be registered per 7 days; [Apple's explanation](https://developer.apple.com/support/compare-memberships/)). On iOS 16 and later you need to turn on Developer Mode on the device.

#### 7-1. Build the IPA (GitHub Actions)

1. Create a Private repository on GitHub and put the contents of this repository in it. A fork would be public, so create a new one. With the GitHub CLI (`gh`; <https://cli.github.com/>), in the repository folder:
   ```
   git init
   git add .
   git status
   git commit -m "first"
   gh repo create any-name-you-like --private --source=. --push
   ```
   Before committing, check that `git status` doesn't list `config.json`, `cloud/state` and the like. When you upload by dragging folders onto the GitHub page, `.gitignore` has no effect, so upload not your working folder but the contents of a freshly downloaded and extracted ZIP (`config.json`, `cloud/state`, `cloud/site` and `cloud/media` contain your own cards and settings)
2. In the repository's "Settings" → "Secrets and variables" → "Actions" → "Variables", create `APP_HOST`. The value is `site_url` without the `https://`
   ```
   gh variable set APP_HOST --body "your-site-hostname"
   ```
   Optionally `APP_NAME` (the name shown on the home screen; the default is "暗記") and `BUNDLE_ID` (the default is `local.selfanki.app`)
3. Build with "Actions" → "build-ipa" → "Run workflow" (2 to 5 minutes). When it finishes, download "SelfAnki-ipa" at the bottom of that run's page and extract it to get `SelfAnki.ipa`. With `gh`:
   ```
   gh workflow run build-ipa.yml
   gh run watch
   gh run download -n SelfAnki-ipa
   ```

The passphrase is not put into the IPA. The first time you open the shell, a screen for entering the code appears.

#### 7-2. Install with iloader

1. Install [iloader](https://github.com/nab138/iloader/releases) (2.4.2 or later). On Windows also install iTunes (the Microsoft Store version is fine), launch it once and accept the license agreement. Linux needs usbmuxd
2. Connect the iPhone/iPad by USB and tap "Trust This Computer"
3. In iloader, sign in with your Apple ID and choose `SelfAnki.ipa` with "Import IPA"
4. On the iPhone/iPad:
   - "Settings" → "Privacy & Security" → turn on "Developer Mode" → restart → "Turn On" and enter your passcode ([Apple's explanation](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device))
   - "Settings" → "General" → "VPN & Device Management" → your Apple ID → "Trust"
5. Open "暗記" on the home screen and enter the code you showed in Step 6

After 7 days, if it says "Unable to Verify" or the like, reinstall the same IPA with iloader and tap "Trust" again. 7-3 automates this.

The code entry screen hasn't been tried in the shell yet (it has been checked only with a build that had the passphrase embedded). If digits from an external keyboard aren't accepted, enter them with the on-screen keyboard.

#### 7-3. Automate the 7-day reinstall (Windows, optional)

A free Apple ID's signature expires after 7 days. If you run the program in `resign/` (selfanki_resign.exe) every 2 hours, it reinstalls from your computer to the iPad/iPhone on the first run after 5 days have passed since the last reinstall. It uses the same components and the same storage (the same signing key) as iloader. In the author's environment, when reinstalling with the same Apple ID, the same device and the same IPA, there was no need to redo "Trust", and the data on the device was kept.

The device to reinstall to is the one written in `udid` in `config.json`. If it isn't written, the first device that could be reinstalled is remembered in `state.json`, and from then on only that device is reinstalled (so it doesn't end up on a different device). When you change devices, delete `udid` from `state.json` or write it into `config.json`.

Prerequisites:
- You have done 7-2 with iloader and, when logging in to your Apple ID in iloader, checked "Save Credentials". This program uses as they are the password that iloader saved in the Windows Credential Manager, the signing key, and the "this PC" registration. It can't be used if you installed with something other than iloader (Sideloadly, AltStore and so on) (untested, but it should stop because it asks for a verification code, or try to create a new certificate and hit the free Apple ID limit)
- The iPad/iPhone is connected by USB or is on the same Wi-Fi as the computer. Whether it is visible over Wi-Fi depends on whether iTunes (Apple Mobile Device) discovers the device over Wi-Fi. Unplug the USB and run step 3 below (if still connected, `--check --wifi`); if "visible via Wi-Fi" doesn't appear, connect by USB, open iTunes, turn on "Sync with this iPad over Wi-Fi" for that device, and try again
- The computer is awake at the reinstall time (it doesn't run during sleep; a missed run happens the next time it wakes)
- Windows 11 (the author only checked Windows 11. The task runs without showing a window by using `conhost.exe --headless`, so it may not work on older Windows 10)

Steps:
1. Build with GitHub "Actions" → "build-resign" → "Run workflow", then download and extract the artifact "selfanki_resign-windows" (you get `selfanki_resign.exe` and `register_task.ps1`). If you have Rust, you can instead run `cargo build --release --locked` in `resign/` (the exe is produced in `resign/target/release/`)
2. In a folder you can write to (for example `C:\selfanki_resign`), put those two files and the `SelfAnki.ipa` made in 7-1. Type the following commands in that folder (in PowerShell, prefix with `.\`, as in `.\selfanki_resign.exe …`)
3. Check (it doesn't connect to Apple, doesn't reinstall, and doesn't write `state.json`)
   ```
   selfanki_resign.exe --check
   ```
   Check: it prints `Check: the device is visible via USB (or Wi-Fi), the password and IPA exist`. If two or more devices are visible it stops; choose from the identifiers it prints and write it in `udid` in the `config.json` in the same folder (created the first time)
4. Reinstall right now, once, to confirm it works
   ```
   selfanki_resign.exe --force
   ```
   Check: `Success: re-signed (USB or Wi-Fi). Next expiry …`. "暗記" opens on the device without "Trust". If it stops asking for a verification code (two-factor authentication), run `selfanki_resign.exe --force --interactive` and type the code in the window. If there are answers that haven't been synced yet, sync them before reinstalling
5. Register a task that runs every 2 hours (in PowerShell)
   ```
   powershell -ExecutionPolicy Bypass -File register_task.ps1
   ```
   To remove it, `Unregister-ScheduledTask -TaskName SelfAnkiResign`. If you register it while skipping 4 (there is no `state.json`), it reinstalls once right away the first time it runs. That does no harm

- The log is `resign.log` in the same folder, and the state is `state.json`. If it stops, Windows shows a notification (device not visible, no password or IPA, login or reinstall failure, a mistake in `config.json`. Notifications of the same kind are limited to once per 12 hours. The "device not visible" notification starts 30 hours before the deadline)
- After a failure to log in to Apple or to reinstall, it retries after waiting 3, 6, 12, 24 hours (so as not to repeat logins). When the device isn't visible or there is no password, it doesn't connect to Apple, so it checks again every time the task runs (every 2 hours)
- If it stopped because a verification code was requested, reinstall with `selfanki_resign.exe --force --interactive` as the notification says
- `resign.log` contains part of your Apple ID (masked like `a***@…`), the device identifier (UDID) when two or more devices were visible, and file locations. Before showing it to anyone, delete these rather than pasting it as is
- If Apple changes the login procedure, it stops at login (503 and so on). In that case, match `anisette_client_info` and `anisette_user_agent` in `config.json` to the values that the new iloader version presents to Apple (the defaults are those of iloader 2.4.2)
- Logging in to Apple is an unofficial method, the same as iloader and SideStore. In the author's environment (Windows 11, iPad), it was confirmed that reinstalling works over Wi-Fi only (with a version from before it was put in this repository). That it reinstalls automatically before the deadline, and that the notification appears on screen, have not yet been confirmed
- There is no version for Mac or Linux

#### If you have a Mac

You should be able to install directly with Xcode (free), without GitHub Actions or iloader, but this hasn't been tried. A free Apple ID can be used as a Personal Team ([Apple's explanation](https://developer.apple.com/support/compare-memberships/)).

1. In `ios/SelfAnki.swiftpm/Config.swift`, change `example.pages.dev` to your site's hostname
2. Open `ios/SelfAnki.swiftpm` in Xcode
3. For signing, choose your own Apple ID (Personal Team). If the bundle ID overlaps with someone else's you get an error, so change `bundleIdentifier` in `Package.swift` to a name only you use
4. Add `WKAppBoundDomains` (an array) to Info.plist and put your site's hostname in it (GitHub Actions does this automatically; without it the app can't open offline)
5. Connect the iPhone/iPad and run

These Mac steps haven't been tried. Apple writes that a Swift Playgrounds app can be opened in Xcode ([explanation](https://support.apple.com/guide/playgrounds-ipad/itcdd1ad55f1/ipados)), but whether this package can be run from Xcode on a real device hasn't been checked.

### Step 8: Syncing with Anki (optional)

Your answers in this app are written to Anki on your computer, and what you studied in Anki (including what you studied in AnkiMobile or AnkiDroid and then synced) is sent here. For each card, the newer side wins. There are two methods, and normally you use the add-on in 8-A.

Either way, take an Anki backup before you start (in Anki, "File" → "Create Backup").

#### 8-A. The Anki add-on "selfanki Sync" (recommended)

It runs inside Anki, so you need neither AnkiConnect nor to worry about whether Anki is running. Each time it syncs, it makes an Anki backup before writing (you can go back with "File" → "Restore from Backup"; only the Anki side is restored, and what was sent to selfanki is not reverted).

1. Build the add-on file
   ```
   python tools/build_addon.py
   ```
   This makes `dist/selfanki_sync.ankiaddon` (you can also build it from the menu shown from the second run of `setup_windows.bat` / `setup.sh`)
2. In Anki, "Tools" → "Add-ons" → "Install from file", choose `selfanki_sync.ankiaddon`, and restart Anki
3. On the computer, show a code (`python tools/pair_code.py`). In Anki, "Tools" → "selfanki" → "Connect", and enter the site address (`site_url`; the `…/pair` that `pair_code.py` prints is also fine) and that code. What it connects to is remembered per profile
4. "Tools" → "selfanki" → "Dry run (count only, write nothing)" and look at the numbers (cards, review logs, marks, deck options). If they are larger than you expected, stop and investigate
5. "Tools" → "selfanki" → "Sync"

- By default it runs only when you press "Sync". If you set `after_anki_sync` to `true` in the add-on's settings ("Tools" → "Add-ons" → "selfanki Sync" → "Config"), it runs right after Anki's "Sync" (AnkiWeb) finishes. AnkiWeb comes first, so what you answered in selfanki reaches AnkiWeb (AnkiMobile, AnkiDroid) the next time you sync in Anki. It doesn't run after the automatic sync when closing Anki (so as not to hold up closing)
- If the connected profile has fewer than half as many cards as selfanki has, it stops before writing anything (a precaution in case you connected to a different profile). Cards deleted in this profile (decks or notes that were deleted) and cards added on a device that aren't yet in Anki are not counted
- Which side to keep is as in "Notes on syncing" (the side that has a newer answer the other doesn't know about; if the answers are the same, the one changed more recently). 8-B uses the same rule
- For answers you undid in this app, the part already written to Anki leaves its log rows in Anki (the card's due date becomes the undone state). Per-deck limits and global settings are not written to Anki. Presets deleted in this app are not deleted in Anki
- Decks created, renamed or deleted on a selfanki device are written to Anki before notes (the id of a created deck is also made the same as on the device). The rules are as in [Creating, renaming and deleting decks](#creating-renaming-and-deleting-decks)
- Notes added, edited or deleted on a selfanki device are written to Anki before cards are compared (the note and card ids are also made the same as on the device). The rules are as in [Adding, editing and deleting notes on a device](#adding-editing-and-deleting-notes-on-a-device)
- The card contents on the Anki side are not sent. If you add or edit cards in Anki, do Step 9
- **Deleting operations are confirmed after showing you the numbers**: deleting in Anki a deck or note you deleted on a selfanki device, and deleting from the device a note that isn't in Anki, are asked about at "Sync" time with the counts (deck names, number of cards to be deleted, number of notes). You choose from "Delete", "Re-add to Anki" and "Not now". In the automatic sync after Anki's sync, it doesn't ask and only tells you how many are waiting
  - When deleting a deck, only the cards the device knew about are deleted. A deck that still holds cards added or moved in Anki after the bundle was made is left, not deleted, and it reports that it still exists on the device too. Cards moved to a different deck on the device are moved first and then deleted
  - If you didn't intend to delete notes that are missing from Anki, for example right after restoring Anki from a backup, choose "Re-add to Anki" (it re-adds them to Anki with the same ids from the device's records)
- **Note fields are matched by name**: the device also sends the order of field names. Even after you add or reorder fields in Anki, contents don't shift and added fields don't end up empty (fields the device doesn't know about keep their contents in Anki)
- **Changes to a note type's shape** (the order or number of fields and card types) always ask after showing what changes (the fields that will disappear and the number of notes with content, the card types that will disappear and the number of cards; the text of Anki's "a full upload of the collection is required on the next sync" is also shown). What it removes from Anki is only fields and card types recorded as deleted on the device; ones the device didn't know about (added in Anki after the bundle was made) are kept

#### 8-B. tools/mirror.py (using AnkiConnect)

A method for when you don't want to install the add-on, or want it to run automatically at a fixed time.

1. Install the AnkiConnect add-on in Anki. "Tools" → "Add-ons" → "Get Add-ons" → code `2055492159` → restart Anki
2. With Anki running, do a trial count (it writes nothing to Anki or the server, and doesn't sync)
   ```
   python tools/mirror.py --dry
   ```
   Check: `Compared: to Anki, cards N reviews N / to server, cards …`
3. The real run
   ```
   python tools/mirror.py
   ```
   Check: the last line has `"ok": true`. On failure the exit code is 1. The log is `cloud/state/mirror.log`

- Deleting operations (deleting in Anki a note you deleted on a selfanki device, and deleting from the device a note that isn't in Anki) are done only when you pass `--allow-delete`. Without it, it only writes the counts to the log (pass it after checking the contents; don't pass it right after restoring Anki from a backup). Creating, renaming and deleting decks is not written by 8-B (use 8-A)
- Before writing, it always takes a copy of the collection (`cloud/state/snap/…_before_write`; `_before_sync` if it is set to sync with AnkiWeb)
- Don't study or edit in Anki while it runs
- It stops if the profile open in Anki differs from the profile of `anki_collection`
- If `ankiweb_sync` is `true`, it syncs with AnkiWeb before and after writing, and also takes a copy before syncing (up to 20 in `cloud/state/snap/`)
- Decks created, renamed or deleted on a device are not written (AnkiConnect can't make a deck's id match the device's). Bring them in with the 8-A add-on. The log says `N decks were created, renamed or deleted on a device…`
- Notes edited or deleted on a device are written to Anki. Notes added on a device, and edits that add cards, are not written (AnkiConnect can't make note and card ids match the device's). Bring those in with the 8-A add-on. The log says `Notes added on a device, edits that add cards, and notes whose note type was edited or changed: …`
- If card contents or decks changed, the site is rebuilt and uploaded again (Step 9 is done at the same time)
- To run it at a fixed time (Anki must be running at that time, and the computer must not be asleep):
  - Windows: in Command Prompt (use your own paths)
    ```
    schtasks /Create /SC DAILY /ST 03:30 /TN SelfAnkiMirror /TR "\"C:\selfanki\.venv\Scripts\python.exe\" \"C:\selfanki\tools\mirror.py\""
    ```
  - Mac/Linux: add one line to `crontab -e`
    ```
    30 3 * * * cd /path/to/selfanki && .venv/bin/python tools/mirror.py >> cloud/state/mirror_run.log 2>&1
    ```

### Step 9: After adding or editing cards in Anki

```
python tools/export_anki.py
python tools/build_site.py --deploy
```

As in Step 5, don't study or edit in Anki while exporting (ideally close it). Devices pick up the new contents the next time they are opened. Newly added cards appear with their Anki learning state and records.

Progress you made on cards already moved, by studying in Anki or AnkiMobile, is not brought in by this. To bring it in, do Step 8 (sync).

If you first put notes added or edited on a device into Anki (Step 8) and then rebuild, cards made on the device go into the bundle as they are (same id, same state). If you later edited the same note in Anki, the Anki content is what appears after the rebuild.

Adding to `exclude_top_decks` doesn't delete the records or device copies of cards already distributed (they just stop being served from now on).

---

### Adding, editing and deleting notes on a device

Available from the same entry points as AnkiMobile.
- Add: "Add" in the top bar of the study screen (the "Add" action can also be assigned to a tap or swipe). Enter the note type, deck, fields and tags and press "Add" at the top right. You can add more in a row (sticky fields and tags are kept). If the first field is empty, nothing is added. When you close with something half-entered, it asks whether to discard it
- Edit: "Edit" in the top bar (key e), or tap a row in the browser. "Save" at the top right. There is also "Tools" → "Delete Note". The eye button previews, and `</>` edits the HTML
- Delete: the "Delete Note" action (key Ctrl+Delete), or in the browser "Select" → "Actions" → "Delete Notes"
- All of them can be undone with "Undo" (sent as a new change; cards added by an edit stay even if you undo)

The front and back of a card are rendered by the device from the template with the same rules as Anki (a port of how Anki 25.09.4 renders; see "What was verified" below). Images for LaTeX (`[latex]`) are not made.

To other devices and Anki, they are sent with "Sync" like other changes. They go into Anki through the Step 8-A add-on (8-B handles only edits and deletes). Which side to keep is decided per note, newer wins:
- The time changed on the device is compared with the time the note was last changed in Anki. Fields and tags together go to the newer side (they aren't mixed field by field)
- Contents changed in Anki reach the device when you rebuild in Step 9. Until then, the device shows its own contents
- If you edited a note on the device and deleted it in Anki, the add-on deletes it on the device too
- If the note type differs from Anki's, or the id collides with another note in Anki, it isn't written (the add-on's result says "could not write")

### Creating, renaming and deleting decks

Available from the same entry points as AnkiMobile.
- Create: "Add/Export" at the bottom → "Create New Deck". Writing `parent::child` also creates a missing parent. If a deck with the same name exists, nothing happens (same as Anki's "Create Deck")
- Rename or delete: in the deck list, swipe a row from right to left and tap "Rename" or "Delete" ("Export" is in [Exporting and importing](#exporting-and-importing-apkg-colpkg)). Tapping elsewhere closes it
  - Renaming also renames the decks below it (filtered decks too)
  - Deleting also deletes the decks below it, the cards inside, and notes left with no cards (same as Anki's "Delete Deck". Cards that are in a filtered deck are also deleted if you delete their original deck). After deleting, "Deleted deck "…" (N cards)" appears
  - Deleting a filtered deck returns its cards to their original decks
  - The default deck (Default) isn't deleted; the cards in it at that time are deleted, and the name goes back to "Default" (same as Anki. The name is in the language of Anki on your computer, and appears on the device after the sync following Step 8-A)
- How names are normalized (strip leading/trailing whitespace and `:`, empty parts become `blank`, names are compared case-insensitively, a collision gets a `+` appended, missing parents are created, nothing can be created under a filtered deck, moving a deck under itself) and the numbers of decks, cards and notes deleted are the same as Anki 25.09.4 (see "What was verified" below)
- You can undo with "Undo" on the study screen (key z, the menu, or shake). However, if you undo after writing to Anki in Step 8, Anki isn't reverted (a deck you deleted also disappears from the device when you rebuild in Step 9). Filtered decks that were under a deleted deck aren't restored

To other devices and Anki, they are sent with "Sync" (recorded in the server's conf table as `dname:<deck id>`). They go into Anki through the Step 8-A add-on (8-B doesn't write them). Which side to keep is decided per deck, newer wins:
- The time changed on the device is compared with the time the deck was last changed in Anki. In Anki, answering a card in that deck also changes the time (rslib's update_deck_stats), so if you rename on the device and then study that deck in Anki or AnkiMobile before syncing, the name in Anki is kept (the same rule as AnkiWeb sync)
- When Anki was newer and nothing was written, or when a deck with the same name existed in Anki and a `+` was added, the add-on returns Anki's name to the device (it shows on the device at the next sync)
- If you rename on the device a deck that was deleted in Anki, it isn't created in Anki (it also disappears from the device when you rebuild in Step 9)
- A note added on the device to a deck created on the device is added to Anki after the deck is created. If you deleted that deck on the device after adding, the note isn't added to Anki

### Changing the passphrase / starting over

If the passphrase may have leaked:
1. Delete the file at `token_file`
2. `python tools/setup_cloud.py` (creates a new passphrase and sets it again)
3. `python tools/build_site.py --deploy`
4. On all devices, enter the Step 6 code again (re-enter it in the Anki add-on too, from "Tools" → "selfanki" → "Connect")
5. In the Cloudflare dashboard, delete that project's old deployments (Deployments)

To start over with a different project or collection, rename `cloud/state` to something else and go back to Step 4. `cloud/state/base.json` is the state at the time of the first transfer, one per project.

### Troubleshooting

| What you see | Cause and fix |
|---|---|
| `npx was not found` | Node.js isn't installed. Step 1. After installing, reopen the terminal |
| `The Python package "anki" is not installed` | You aren't running the virtual environment's python. The table in Step 1 |
| `config.json is not UTF-8` | In Notepad or similar, choose "UTF-8" and save again |
| `Could not create the virtual environment` (Ubuntu, Debian) | `sudo apt install python3-venv` |
| `AnkiConnect is too old…` | Update AnkiConnect in Anki under "Tools" → "Add-ons" |
| `cloud/state/base.json is for the project "…"` | You're using the working folder of a different project. "Starting over" above |
| `Not logged in to Cloudflare` / `not authenticated` | `npx --yes wrangler@4.165.0 login` |
| `More than one account available` | You have several Cloudflare accounts. Add `"cloudflare_account_id": "…"` to `config.json` (the ID is the 32-character string in the URL in the Cloudflare dashboard) |
| `The copy of the collection was corrupted all 3 times` | The copy was taken while you were studying or editing in Anki. Close Anki and try again |
| `config.json is not valid JSON` | Most often a `\` in a Windows path. Change it to `/` |
| `There were 0 cards to export` | `exclude_top_decks` excludes everything |
| `missing` in the export isn't 0 | Those images/audio are missing from Anki's folder. In Anki, "Tools" → "Check Media" |
| An error saying 20,000 files were exceeded when uploading | There are too many images/audio. Put unused decks in `exclude_top_decks` and redo Step 5 |
| An error saying the collection is too new to open when exporting | Take a backup first, then in Anki on your computer choose "File" → "Switch Profile" → "Downgrade & Quit", and then export |
| `Unauthorized` on a device / the code screen appears | That device hasn't been connected yet. Step 6 |
| `Wrong or expired code` | A code is valid 15 minutes, single use. Show a new one with `python tools/pair_code.py` |
| The site isn't reachable | If it was just created, wait a few minutes. `python tools/doctor.py` |
| The iOS shell says "Unable to Verify" | The free signature's 7 days have run out. Reinstall as in Step 7-2 and "Trust". From next time you can automate it with 7-3 |
| `Failed to connect to usbmuxd` in iloader | On Windows, you haven't launched iTunes and accepted the license agreement |
| A `keyring` error in ipatool (Windows) | Step 4 of A. Add `--keychain-passphrase` to every command |
| `Cannot connect to AnkiConnect …` during write-back | Anki isn't running, or AnkiConnect isn't installed |
| `The profile open in Anki ("…") differs from the profile of anki_collection` during write-back | In Anki, switch to the profile of `anki_collection` |
| In the add-on: `This profile has only … of the … selfanki cards` | You connected to a different profile. Switch profiles in Anki, or "Tools" → "selfanki" → "Disconnect" |
| In the add-on: `The selfanki server refused access (wrong passphrase)` | The passphrase was changed. Re-enter the code in "Tools" → "selfanki" → "Connect" |

### Fixing and changing note types

- **Card templates**: the "Card Templates" action on the study screen (under "All" in the gear menu; it can also be assigned to a tap or swipe). The screen follows a real AnkiMobile 25.09 device (compared on 2026-11-23): at the top "Back", "Card Templates" and "Undo" (dimmed until you change something; pressing it restores the contents from when it was opened), below that "Front | Back | Styling | Preview", and the body is a field that edits the template of the current card's card type as is. The preview renders the current card's note with the template and styling being edited, and the "Flip" at the top right switches between front and back. "Back" saves (the real device has no save button; the "Changes saved." message shown on saving hasn't been compared with the real device)
  - Removed from the screen because the real device doesn't have them: "Options" (adding, deleting, renaming and reordering card types) and "Fields..." (adding, renaming, reordering and deleting fields, and the sort field). The rules and the sync mechanism (conf's nt:<id>, and the add-on checking for schema changes before writing to Anki) are kept, and appear only when `?debug` is added to the URL (for testing sync). To add or delete card types or fields, do it in Anki on your computer and then Step 9
- **Change Note Type**: select in the browser and choose "Actions" → "Change Note Type". Choose the target note type and the mapping of fields and templates (the default mapping, the rules for switching to and from cloze, and the notices about contents and cards that will be lost are the same as Anki's). The selected notes must all be of the same note type
- The rules are the same as Anki 25.09.4 (rslib's notetype/): fixing names (removing unusable characters, a "+" for the same name), fixing templates when a field is renamed or deleted, and being unable to save when the front is identical, the front has no fields, a field doesn't exist, or there is no cloze (same messages as Anki); deleting a template deletes its cards, reordering also reorders card numbers, and adding one or changing the front creates cards (the position and deck of new cards are also the same as Anki)
- You can undo and redo ("Undo" and "Redo" on the study screen)
- To other devices and Anki, they are sent with "Sync". Note types go in the conf table's `nt:<id>` (fields and card types are matched by id), and rewritten notes go in the notes table
- **Only the add-on (Step 8-A) writes to Anki.** Changing the order or number of fields or card types, the sort field, or changing the note type is a "schema change" in Anki, and the next sync with AnkiWeb becomes one-way (a full upload from this computer). Before writing, the add-on shows the same confirmation as Anki ("A full upload of the database will be required on the next sync to sync this change with other devices. … Do you wish to proceed?"); if you answer "No", it doesn't write and leaves it pending (it doesn't write that note type's notes either; it asks again at the next sync). Changes only to the contents of templates, styling, or names are written without asking
  - Because it becomes one-way, **if AnkiMobile, AnkiDroid or another device has studying that hasn't been sent to AnkiWeb yet, sync those first** and then write with the add-on
- It can't be written by AnkiConnect write-back (Step 8-B, mirror.py). Notes of note types fixed on the device, and notes whose note type was changed, are not written; only the counts go in the log

What it can't do, or does differently:
- Cards of decks not in the bundle (Steps 5 and 9) don't exist on the device, so even if you add a card type on the device, those cards aren't made on the device (Anki makes them when written by the add-on; they come to the device when you rebuild in Step 9)
- A note added on the device doesn't change the per-note-type "last deck added to" (when you change a note type, the new cards of notes that keep no cards go into the "last deck added to" from when the bundle was made)
- In a deck whose new card position is "Random", the random numbers for positions of created cards differ from Anki's (in sync between devices and with Anki, the device's positions go in as they are)

### Exporting and importing (.apkg, .colpkg)

Available from the same entry points as AnkiMobile. The files it makes can be read as they are by Anki 2.1.50 or later, AnkiDroid and AnkiMobile (the legacy format = the same as Anki's "Support older Anki versions").
- Export a deck: in the deck list, swipe a row from right to left and tap "Export" → choose "Include scheduling information", "Include deck presets" and "Include media" → share sheet (on browsers that can't, saving a file). The decks and filtered decks below it are included. The way it is chosen is the same as Anki (the cards currently in that deck, and the other cards of those notes. Cards that are in a filtered deck aren't included even if you export their original deck)
- Export the collection: "Add/Export" at the bottom → "Export Collection" → `collection.colpkg`. Only what is on the device (decks excluded by `exclude_top_decks` in Step 2, and decks starting with `_`, aren't included)
- Import: "Add/Export" at the bottom → "Import from iTunes" and choose an .apkg or .colpkg (on iOS, choose from the Files app. This replaces "Open in AnkiMobile")
  - .apkg: choose "Include learning history" and "Include deck presets" (both off by default, as in Anki). The rules are the same as Anki 25.09.4: a note with the same guid is updated if the file's is newer, otherwise skipped. If the note type differs, it isn't imported. A note type with the same id but different contents is added as a separate note type. Decks are matched by name. An image with the same name but different contents gets its sha1 appended to the name. When done, the counts are shown with the same wording as Anki
  - .colpkg: as in AnkiMobile, it replaces the current collection. After a confirmation dialog, it shows the number of additions, updates and deletions and asks once more. **At the next sync, the same deletions and changes also go into Anki on your computer (Step 8-A)**
- To other devices and Anki, they are sent with "Sync". Note types go in the conf table's `nt:<id>`, notes in the notes table (with added guid and imp columns), and images and audio in D1's media table (stored in 1 MB pieces, and served at `/bundle/media/<name>` when not in the bundle). They go into Anki through the Step 8-A add-on (it creates only note types with the same id, notes with the same guid, and the cards that were in the file, writes the learning state and records, and fetches images and audio into collection.media). 8-B doesn't write them
- When you rebuild in Step 9, imported content also goes into the bundle (after that the bundle is newer, so the bundle is used)

What it can't do, or does differently:
- Downloading shared decks (directly from the AnkiWeb list), and "Open in AnkiMobile" from other apps (iOS browsers can't present themselves as apps that open files)
- "Merge note types" on import, and the "Always" and "Never" choices for "Update notes" and "Update note types" (it is always "If newer than existing")
- An imported filtered deck exists only on the device (it isn't created in Anki; its cards are in their original decks in Anki). A filtered deck removed by a replace is also left empty in Anki
- What a .colpkg replace can't do (the counts appear in the dialog): notes with the same id but a different note type, deleting only cards not in the file, deleting study records that exist only on the device, and rewriting note types whose field and template order differ
- Exported images and audio are those the device has fetched or that can be fetched from the net (ones not yet fetched are not included when offline)

---

### What was verified

| What | Against what | Result |
|---|---|---|
| Interval calculation (including fuzz random numbers and load balancing) | Compared with Python Anki 25.09.4 | All 13,200 cases match |
| Interval calculation with FSRS off (SM-2) (4 presets x 7 card states, with and without load balancing, early review in custom study), and the card and review log after answering | Compared with Python Anki 25.09.4 | All match: 2,240 next states, 240 early-review cases, 376 after-answer runs |
| Day boundary (5 values of next day starts at x 5 time-zone offsets at creation x 32 creation date-times, 5 time zones) | Compared with Python Anki 25.09.4 | All 4,000 cases match |
| Order options (6 ways to gather new cards, 5 ways to sort them, 12 review sort orders, 3x3 ways to mix, with and without FSRS, the setting that applies parent limits, new cards ignoring review limits) | Compared with Python Anki 25.09.4 | Gathered cards and order match in all 124 cases |
| Order cards are shown in (8 combinations of sibling burying, and burying after answering) | Compared with Python Anki 25.09.4 | Gathered cards and order match in all 8, and burying after answering matches in all 96 runs |
| Order of answering (how reviews and new cards are mixed, and limits; it takes from the gathered order rather than rebuilding after each card) | Compared with the order of answering to the end in Python Anki 25.09.4 | All 5 cases match |
| The gear menu's "Handwriting Pad" (show/hide remembered per note type, cleared on the next card, short and long press of undo, size, opacity, thickness, placing it under the bar) | Built from values measured on a real AnkiMobile 25.09 device (iPad) and checked in Chromium | Passed. Comparing selfanki's handwriting pad on a real iPad is still to do |
| Assignments of taps (9 zones x front/back), swipes (4 directions; vertical ones from the left and right edges) and the top bar (9 buttons), the gear menu's "All Actions", Aa (text size, 0.1 to 10.0 times), and automatic card advance (seconds and behavior from the deck options) | Names, order, defaults and steps follow a real AnkiMobile 25.09 device and the manual; automatic advance follows Anki 25.09.4's reviewer.py; checked in Chromium | Passed. Comparing selfanki's side on a real iPad is still to do |
| Type-in-the-answer ({{type:…}}, {{type:cloze:…}}, {{type:nc:…}}; the input box, Enter to show the answer, the comparison result, and the setting "Don't answer by typing") | Compared against Python Anki 25.9.4's compare_answer and aqt's reviewer.py typeAnsFilter itself, and the flow checked in Chromium | Comparison results 3,918 cases and insertion into front and back 72 cases all match |
| Forget and Set Due Date (from All Actions, taps and so on; the log entry is type 4 "Manual", and it can be undone) | Compared with Python Anki 25.9.4 (FSRS on and off; new, learning, review and relearning; resetting the original position and counts; "0", "5", "3!", "12!" and so on) | State and log match in all 480 cases. A range such as "3-7" is chosen uniformly as in Anki (the random sequence itself isn't matched). The look of the dialog hasn't been compared with a real AnkiMobile device |
| Answer-confirmation marks (the shape, position and fade of the check and cross), "?" in the list (opens the manual), the Sync button color (orange when there is unsent data), tool icon display and left/right, the three levels of double-tap prevention, the shake action, opening card links outside, not showing the handwriting pad | Measured on a real AnkiMobile 25.09 device (for the marks, photographing right after the press every 0.1 s). "Short" and "Long" double-tap prevention and shake strength are unmeasured estimates. Checked in Chromium | Passed |
| The "by type" answer-confirmation mark (directly above the button, in the same color as the button), the browser's "Select" and "Actions" (Change Flag, Suspend / Unsuspend, Set Due Date, Forget; the rest dimmed) | Measured on a real AnkiMobile 25.09 device. Checked in Chromium | Passed |
| Card Info (Anki's own screen: due, interval, time, preset, memory state, retrievability, per-review memory state and forgetting curve) | Compared with Python Anki 25.09.4's card_stats on 4 sample collections (864 cards: new, learning, review, relearning, suspended, filtered decks, 0/17/19/21 parameters, "ignore reviews before") | 859 cards match (858 match down to the byte string returned). The other 5 differ by 5 to 6 ulp in the per-review stability as a floating-point value (not visible in the display) |
| Deck options "Optimize" (optimizing parameters; creation of training data, outliers, initial stability, Adam, learning rate, the random numbers for batch order, and range clipping all follow fsrs-rs 5.1.0) and the health check | Python Anki 25.9.4's compute_fsrs_params, on 5 sample collections (405 to 33,941 reviews) x 3 "ignore reviews before" settings x relearning steps 1 to 3 = 45 cases, plus 9 cases with health check and with current parameters | In 52 of the 54 cases, the 21 parameters differ by less than 1e-5 (mostly less than 1e-6; the 4 displayed decimal places are the same). The cards whose next interval (desired 90%, no fuzz) then changes number at most 1 in 3,000, apart from those exactly at a .5 rounding boundary. The health check pass/fail matches 3 of 3. In the remaining 2 cases (both with 30,000 reviews and 3 relearning steps), differences in f32 gradient rounding accumulated so that the one round where difficulty touches its lower bound during training was off by one, and parameters differed by up to 0.035 (85% of cards then change interval). Pressing "Optimize" in Chromium on the local Cloudflare gave parameters identical to Anki to 4 decimal places |
| Evaluation (Log loss and RMSE. The button for the "old evaluation" setting) | The same 4 cases as above x 2 parameter sets | All 8 cases match to 5 decimal places (in 1 case the 6th digit of log loss was off by 1) |
| Simulator (reviews, new cards, time and remembered cards per day) | Python Anki 25.9.4's simulate_fsrs_review, 9 cases (with and without load balancing, 4 review orders, burden-reduction days, suspending by limit or number of lapses, desired 80% and maximum interval, number of learning steps). Includes the case of filling in cards with no memory state | 8 cases match on every day's values down to the f32 bits. In 1 case the remembered-cards count differed in the last digit on 2 days (reviews, new cards and time matched) |
| Help Me Decide (simulation for each desired retention from 70 to 99%), the workload multiplier when you change the desired retention, and the estimate of optimal retention | Python Anki 25.9.4's simulate_fsrs_workload, get_retention_workload (2 collections) and compute_optimal_retention (5 cases) | 30/30, 60/60 and 5/5 match (for optimal retention, 4 cases hit the lower bound 0.70 and 1 case gave 0.7291) |
| Recalculation of memory states when saving deck options (when changing parameters or desired retention, or turning FSRS off) and the rescheduling of due dates under "Also reschedule existing cards when parameters change" (load balancing, log type 5) | Python Anki 25.9.4's update_deck_configs, 4 cases (920 cards) | The 2 cases that changed parameters (with and without rescheduling) and the FSRS-off case match 920/920 (down to memory state, desired retention, decay, due date, interval and the added log). In the case that changed only the desired retention, 917/920 (3 cards differed in the last f32 digit of stability, so the stored 4-decimal value was off by 0.0001 to 0.0002; due dates matched) |
| The features above from the UI (Optimize, the workload notice when changing the target, simulator, estimate, Help Me Decide, the count for "ignore reviews before", saving), plus sync after saving and write-back through the add-on | Local Cloudflare (wrangler pages dev), Chromium, Anki 25.9.4 (WSL, headless) | Passed (the optimized parameters and the workload notice "about 0.91x" are the same as Anki; the memory states and due dates of the 800 rescheduled cards and 800 type-5 log entries went into Anki). Speed on a real iPad hasn't been seen yet |
| The browser's "Reposition" (start position, step, randomize, shift existing cards) | Python Anki 25.09.4's sort_cards, 60 cases | For the 45 non-random cases all cards' positions match; for the 15 random cases the set of positions matches; the number of changed cards is 60/60 |
| Image occlusion cards (cover on the question, uncover on the answer, Toggle Masks) | An image occlusion note made in Anki 25.9.4, Chromium (using Anki's reviewer.js as is) | Passed |
| TTS voice and speed (voices and speed of {{tts}}), gamepad (the default assignments are values from a real AnkiMobile device; the stick advances cards), Settings > Study > Scheduling (rollover hour and learn-ahead limit; synced to other devices and not written back to Anki) | Chromium (gamepad with simulated input). Speech in the shell isn't verified | Passed |
| Settings' "Check Database" (re-fetching the device's copy from the server), "Check Media" (reports missing and unused) and "Empty Cards" (report only; delete them in Anki on your computer) | Empty Cards found the same 3 cards as Anki's get_empty_cards. Chromium | Passed |
| The Sync button color (orange for any of: unsent changes, newer changes on the server, deck opened = sync for the current deck) | Chromium (on 2 devices) | Passed |
| The browser's "Add Tags" and "Remove Tags" (the dialog uses the real device's wording and a single input; case-insensitive, with * and child tags) and "Find and Replace" (as on the real device, just two inputs "Find:" and "Replace With:"; as in Anki's defaults, literal, case-insensitive, all fields). All sync as note edits, and Undo reverts all of it in one step | Wording seen on a real AnkiMobile 25.09 device. Chromium, WebKit | Passed. Not compared against Anki |
| The actions "Record Voice", "Play Recorded Voice" and the recording menu (the recording stays only on the device and is cleared on the next card) | Chromium (with a fake microphone). Not compared with the look of the official app | Passed |
| The browser's "Change Deck" (the same full-screen "Select Deck" as the real device: top left "N/M selected", top right "Add New" = create a deck and move there, full names, a check mark on the deck if all selected cards are in the same deck. For cards in a filtered deck the original deck changes). Only cards moved on the device are synced, with did and the move time didAt in their state, and the add-on and mirror.py move the Anki card only when didAt is newer than the card's last change in Anki (what was moved later in Anki isn't moved back). Undo sends the previous deck with a new time | Chromium + headless Anki 25.9.4 | Passed (move, undo, move, sync moves it in Anki too, and the second sync shows no difference) |
| When a deck change and a move in Anki collide (move in Anki, suspend on a device that hasn't synced, sync / move on the device, move to another deck in Anki, suspend on the device, sync) | Chromium + headless Anki 25.9.4 | In both, the deck moved later in Anki is kept, and from the third sync there is no difference |
| The "Redo" action (redoing undone answers; hide, suspend, flag, mark and deck changes; note add, edit and delete; deck create, rename and delete. It disappears when you do a new operation. An answer is re-answered with the same button and the same answer time) | Chromium | Passed for answers, suspend, adding tags and deck changes. Redoing a deck rename wasn't tried |
| The wording of the gear menu's "Undo" and "Redo" (Anki's translation "Undo X" and "Redo X"; an answer is "Answer Card"), and being tappable only when redo is possible | Chromium | Passed |
| The edit screen (matched against a real AnkiMobile 25.09 device on 2026-11-23): the toolbar is B, I, U, Fx, eye, brush, microphone, clip, pen, √, </> in that order, and with no field selected only the eye and </> can be pressed. The top bar has "Back", "Tools" in the middle, and "Save" only when something has changed. When going back, "Discard changes?" (Keep editing / Discard). √ shows a horizontal bubble under the button with x² (superscript), x₂ (subscript), \( (MathJax inline) and \[ (MathJax block). The brush shows 8 color dots above the bar (for dark, #ffffff, #0091ff, #31d158, #ff9230, #ff4246, #db33f2, #ffd702, #8e8e93 as measured on the real device. **The 8 light colors are guesses from iOS's light system colors** and haven't been seen on the real device). The clip offers "Add Media": From Camera, From Photos, From Files. When microphone permission is missing, the real device's wording is used. The pen is a full-screen "Handwriting" (Cancel / Save, white paper, below it Undo, Redo and 5 colors = colors measured in the real device's iOS handwriting tool; no pen types, ruler or color wheel) | Chromium, WebKit | Passed. The recording screen couldn't be seen because the real device had no microphone permission, so it stays as currently built. The top bar of the add screen hasn't been compared |
| The edit screen's clip (camera, photo library, files), microphone (record and save) and pen (draw on white paper to PNG). Names are the same as Anki (unusable characters removed, NFC, 120 bytes; the same name with different contents becomes "name-<sha1>", and photos and handwriting are paste-<sha1>). When added, they are sent to the server right away and the add-on fetches them into Anki's collection.media | Chromium (fake microphone) + headless Anki 25.9.4 | Passed (contents match, the same contents get the same name, different contents are renamed, and the second sync shows no difference). The menu wording and the microphone's placement haven't been compared with the real device |
| Backups (Settings > Backup. When the app is closed or switched away, if the "automatic backup interval (minutes)" has passed since the previous backup and the collection has changed, a .colpkg without images and audio is made on the device. "Create Backup", thinning (the number of daily, weekly and monthly representatives), and restoring from the list = the same replacement as importing a .colpkg. Names and thinning follow rslib 25.09.4 collection/backup.rs) | Node (the same inputs as rslib's thinning_manual and thinning_generic, even in a time zone with daylight saving) + Chromium + Anki 25.09.4 | Thinning matches in both. The files it made open in Anki and the database check finds no problem. Restoring brings back the card states, but log rows that exist only on the device aren't removed (the same as a .colpkg replace) |
| Adding by URL, searching and syncing (AnkiMobile's URL scheme addnote, search and sync, via `#x-callback-url/…` on the app's URL: type, deck, fld<name>, tags, dupes, profile, x-success; URLs to images and audio are fetched and made into files) | Chromium | Passed (duplicates, a missing note type, a missing field and a different profile are errors; an image from a URL goes in with the name from fakePath) |
| Settings > Sync "Sync audio and images" (when off, images and audio added on the device aren't sent and aren't prefetched for offline use; turning it back on sends them at the next sync) | Chromium | Passed. "Show media sync progress" still can't be pressed |
| Settings > Editing: maximum image size (long side of photos from the camera and photo library), saving pasted images as files ("Paste as PNG" off gives JPEG = the same default as Anki desktop; "Resize on paste"), capitalize first letter and autocorrect (input attributes), and ignoring fingers on the handwriting screen | Chromium | Passed. Photo cropping, video quality and smart quotes can't be changed from the web and remain unpressable. How the maximum image size is chosen (typing a number) hasn't been compared with the real device |
| Settings > Study > Notifications "Show due count on the app icon" (the Badging API. For an app on the home screen on iOS 16.4 or later; notification permission is needed. The number is the sum of New + Learning + Review in the top row of the deck list, and is updated when the list is shown and when the app is closed) | Chromium (watching the API) | Passed. Whether new cards count toward the number hasn't been compared with the real device. It doesn't appear in the shell (WKWebView). "Notify at a set time" needs a mechanism that sends from the server, so it still can't be pressed |
| "Add/Export" "Download from Link" (fetches the URL of an .apkg or .colpkg through your own server's `/api/fetch` and goes to the normal import) and "Download Shared Deck" (opens the AnkiWeb shared decks page). `/api/fetch` accepts only a POST from someone with the passphrase plus a dedicated header, only http and https, up to 300 MB | Chromium + a local web server | Passed (no header gives 400, GET gives 405, no passphrase gives 401, file: gives 400; the import gives the same result as a normal .apkg import) |
| Card video (`[sound:x.mp4]` and so on) is shown over the card as video, not just sound. Settings > Study "Loop video" and "Show video playback controller", go on to the next sound when it ends, tapping outside or showing the answer stops it, and the actions pause, fast-forward and rewind | Chromium (webm) | Passed. How it is shown (overlaid on the card) hasn't been compared with the real device |
| "Check Media" also counts images and audio added or imported on the device (on the server, and ones not yet sent) as "present". Deleted cards aren't counted. Names starting with `_` aren't counted as "unused", as in Anki | Chromium | Passed |
| The page policy (CSP) for the app screen (`/app/`) gains `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'`, and the card frame (srcdoc) inherits it. Inline scripts that got into a card, attributes such as `onerror`, `javascript:` links and scripts inside `<iframe srcdoc>` don't run (so the device's records can't be read from the contents of a received deck or .apkg). The MathJax configuration was moved to a file (`app/mjconfig.js`) | Chromium, WebKit | None of the 4 kinds of malicious script ran, and MathJax (the main frame and the preview), sql.js, the FSRS Worker and image occlusion work. `all.py` counts as an error anything blocked by the page policy |
| Name collisions for images and audio: the server refuses a file with the same name but different contents (before writing chunks; protecting the other party's file), and the device doesn't send once refused. When the server's list can't be fetched (offline), things added under their original name get a sha1 appended to the name. The backup's "has it changed" check also looks at note types, deck descriptions and limits, and global settings. The backup storage is up to 1/4 of the device's capacity as a guide (500 MB if unknown) | Chromium | Passed (2 devices adding the same name, the list not being fetchable, sending directly, and the same contents again) |
| The browser's "Filter" (as on the real device, a bubble under the button; the search box "Filter" narrows the items and highlights the typed text in blue. The flat list: Whole Collection, Current Deck, Added Today, Studied Today, Again Today, New Cards, In Learning, Learning Count, Due, Suspended, Flags 1 to 7, No Flag, Has Flag, "Deck: name", "Tag: name", "Note: name". Tap = replace the search; swipe sideways = just append to the current search with a space (no parentheses). The search syntax follows rslib) | Items, order and placement seen on a real AnkiMobile 25.09 device (at 834 pt width, left 119 and right 719, with the triangle pointing at the button). Chromium, WebKit | Passed. Saved searches, card types and fields aren't on the real device's list, so they aren't shown |
| The browser's "Options" (the gear: "Undo X", note mode, sort order (13), reverse sort, columns 1 to 6 (16; defaults Sort Field, Card Type, Due, Off, Off, Off), delete unused tags (can't be pressed). The chosen values are remembered only on this device), the column texts (date-time "2026-11-23 @ 10:46", due "New #N" and "(Filtered)", suspended and buried in parentheses, interval "1.5 months", ease, deck "Mid (original)", answer's 🔉name🔉, counts and totals in note mode) and sorting (and reversed; ties are also ordered to match the order Anki reads them from SQLite) | Python Anki 25.9.4's find_cards, find_notes and browser_row_for_id, on 9 randomly generated collections (new, learning, review, relearning, suspended, buried, filtered decks, flags, nested decks, sort fields in numeric form, emoji) | Orders match in all 52 cases x 9, and column texts (15 card columns, 15 note columns) all match. On screen too (Chromium, WebKit), the order and text of cards and notes match in 13 x 2 cases |
| The browser list: columns split the window equally (for 3 columns, centered from 6 px, 1/3 + 3.5 px, 2/3, the same as the real device), row background in the order Flag, then Mark, then Suspended (the flag colors are the real device's red #d26061 = 0.85 times Anki's dark color; the other 6 colors and the light screen are estimates), text in flagged rows is white, search terms (those not of the form key:value) are highlighted blue #77ccff in the list. The position of the top bar buttons | Measured on a real AnkiMobile 25.09 device. Chromium, WebKit | Passed. The color of buried rows hasn't been seen on the real device, so none is applied |
| The browser's "Preview" (the eye: each card in the list one at a time. At the top "i/N", the square at the top right = question only vs. question and answer, at the bottom ◀ previous, ⏮ first, ⏭ last, ▶ next. Also with the keyboard ← → Home End) | The layout seen on a real AnkiMobile 25.09 device. Chromium, WebKit | Passed. The meaning of the square (switching between question and answer) is an estimate |
| The add-on's delete paths (the 11 items from the second review): delete operations are confirmed after showing the counts (only a notice in automatic sync); deck deletion happens after moving cards and covers only cards the device knew about; for a note not in Anki, "Re-add to Anki" can also be chosen; fields are matched by name (fn in the server's notes); note types are deleted only if recorded as deleted on the device; schema changes always ask after showing the contents; the deck-name deadlock is resolved; if a note type can't be written, that note isn't written; an imported note doesn't overwrite an Anki note with a different guid; cards not in the template aren't created; names of images with `:` and the like are refused; and mirror.py has `--allow-delete` and a copy before writing | Headless Anki 25.9.4 (11 cases with a fake server + 9 reproductions from the review), and end-to-end tests of note types, .colpkg and decks | All passed (the end-to-end deck test showed 0 differences at every stage. The confirmation dialogs were answered "Delete" automatically) |
| Things matched by measuring on a real AnkiMobile 25.09 device on 11/23 (main part): Settings > Study > Bottom Bar's "Bottom bar size" (Small, Normal, Large, Extra Large; answer button height 26, 52, 76 and 166 pt; Small is only the spacing in one row) / the swipe buttons in the deck list "Export", "Rename" and "Delete" and their colors, and swiping all the way deletes ("Confirm Delete / Are you sure?") / the order in Settings > Sync (connected site, media log, one-way sync (can't be pressed in this build), log out, network timeout, self-hosted sync server) / the order in Settings > Backup (interval and number to keep → Anki's explanation → "Available Backups" → "Create Now" → username and a date-time like `2026/11/23 10:46:00`) / the gear menu's "Redo" stays in a pressable color even when there is nothing to redo | Chromium | Passed. The margin under the bar's height (safe area) hasn't been compared with the real device |
| Export (deck: with and without scheduling, nested, filtered decks (with and without), collection). On a collection containing marks, leeches, suspensions, flags, images, audio, presets and descriptions | Compared against Python Anki 25.09.4's own export, and what it gives when imported into an empty collection (from Node and the Chromium screen) | All 6 cases are the same |
| Import (new and old format, with and without learning history and presets, a deck from another collection (new note types, nesting, presets, images with the same name but different contents, logs, filtered decks), your own export (duplicates), updates to notes and note types, note type conflicts) | Compared against the result of Python Anki 25.09.4 importing into the same collection | All 7 cases are the same. Importing then exporting from the Chromium screen gives the same too |
| Step 8-A for imported content (note types with the same id, the same guid, cards, learning state, logs, presets, deck descriptions, images and audio. The second run does nothing) | Local Cloudflare, Python anki (the add-on's contents) | Same as Anki's own import (the only difference is filtered decks that exist only on the device) |
| A .colpkg replace (note deletion, update and addition, moving cards to another deck, deck rename and creation, filtered deck deletion, presets, logs, images) and Step 8-A | Same as above, Chromium | After the replace, the device's contents are the same as the original collection. Anki is the same too (only the emptied filtered deck remains) |
| After fixing note types (adding, deleting, renaming and reordering fields, the sort field, adding, deleting, renaming and reordering card types, front, back and styling) and changing note type (mapping fields and templates, switching between normal and cloze): the note type, the note contents, card numbers, decks and new-card positions, and the reasons it can't be saved | Compared against Python Anki 25.9.4 with random collections and operations | All 500 cases match (247 fixes, 211 changes, 42 where neither can be saved; the kinds of reasons are also the same) |
| Fix card templates and fields and change a note type on the device → sync → add-on (the first time "No", writing nothing; the second time "Yes") → the note type, notes, and card ids and numbers in Anki are the same as the device's → no difference the third time → another device is the same. Then delete card types and fields and reorder, undo and redo → sync → add-on | Local Cloudflare (wrangler pages dev), Chromium, headless Anki 25.9.4 | Passed (0 differences) |
| Search | Compared with Anki 25.09.4 | 739 of 740 match (only the error message for `-and` differs) |
| Cards and positions that go into a filtered deck (12 searches x 10 orders + 25 cases of two filters, with and without FSRS, today as day 0 and otherwise. Excluding suspended, buried and cards of other filtered decks) | Compared with Python Anki 25.09.4's rebuild_filtered_deck | For the 509 cases where the order is determined, cards, positions and even the kind within it all match. For the 71 random cases, the counts match in 70 (in 1 case, the count of the second depends on the cards picked by the first random one) |
| Cards and records after answering in a filtered deck (reschedule or not = 4 preview-seconds settings; new, learning, learning that crosses a day, review, relearning; with and without FSRS; up to 3 in a row) | Compared with Python Anki 25.09.4 | All 1,031 runs match (the FSRS memory state differs in the 4th decimal place in 34 runs. The same difference shows up in 39 of 480 runs when answering in an ordinary deck, so the filtered deck isn't the cause. The add-on treats them as equal within the same margin) |
| The order and count shown when opening a filtered deck (5 definitions x 3 collections) | Compared with Python Anki 25.09.4's get_queued_cards | All 15 cases match in order and count |
| The flow of the filtered deck screens (create, compare with the contents Anki builds from the same definition, answer, rebuild, empty, undo, rebuild from "›", a preview deck made in Anki, custom study (forgotten, tags), the browser's deck:filtered, syncing to a 2nd device, edit, delete, the refusal cases) | Local Cloudflare (wrangler pages dev), Chromium | All 34 items passed |
| Step 8-A for answers in a filtered deck (rescheduled answers go into Anki, preview answers go in only as logs and the card doesn't change; the second run does nothing; a card answered in Anki leaves the device's filtered deck) | The add-on's sync in Anki 25.9.4 (WSL, headless), local Cloudflare | All 11 items passed |
| Rendering the front and back of a card from the template (notes added or edited on the device. Fields, conditionals `{{#}}` `{{^}}`, cloze (nested, hints, inside MathJax), image occlusion, furigana, kanji, kana, text, hint, type (cloze, nc), tts, `[sound:]`, FrontSide, special fields such as Tags and Deck, unknown filters, `{{=<% %>=}}`) and the cards to create (ord) | Python Anki 25.9.4's render_output (with the same post-processing as export), on 4 randomly generated collections (1,780 notes, 4,066 cards) | Front, back, audio marks, type-in and ordering fields match 4,066/4,066, and the cards to create match 1,780/1,780 |
| On the device: add notes (4 kinds, another deck), study, edit (notes made on the device and Anki's notes), delete, undo → Step 8-A to Anki → another device → rebuild in Step 9. When they collide (Anki newer, device newer, a note made on the device deleted in Anki) | Anki 25.9.4 (WSL, headless), local Cloudflare, Chromium (the add flow also on WebKit) | Passed (comparison of Anki's note and card ids, fields, tags, decks, new positions and answered state all match across 37 items, Anki's rendered front and back match the device's rendering 6/6, the 2 devices look the same, and the second run does nothing). Comparison with AnkiMobile's screens is still to do |
| Deck create, rename and delete (name normalization, parents, children, `+` on collision, moving under itself, the error for creating under a filtered deck, the numbers of decks, cards and notes deleted, the default deck, cards inside a filtered deck) | Python Anki 25.09.4, with 150 random operation sequences x 40 steps | All 6,000 steps match (1,972 creations, 3,034 renames, 994 deletions. The 74 errors occurred at the same places too) |
| Writing decks in Step 8-A (swapping, parent and child, the id of a created deck, deleting, Anki newer, name collision, the default deck (once), nothing on the second run, the guard against mix-ups doesn't count cards it deleted) | Directly on a Python Anki 25.09.4 collection | All 20 items passed |
| The flow of the deck create, rename and delete screens (the 3 swipes, dialog wording, adding a note to a created deck, the same name, create then delete, add then delete, cancel, undo, the default deck) → Step 8-A → another device → rebuild in Step 9. When they collide (a deck renamed in Anki then changed or deleted on the device, name swaps, a deck with the same name in Anki) | Local Cloudflare (wrangler pages dev), Chromium and WebKit, Anki 25.9.4 (WSL, headless) | Passed (at every stage, the device's list and per-deck card counts match Anki. A created deck keeps the device's id) |
| Editing and deleting a device's notes in Step 8-B (additions are counted without being written) | A stand-in for AnkiConnect (answering with Python anki), local Cloudflare | Passed |
| Step 8-A (add-on): connect, dry run, sync (makes a backup, answers on the device go into Anki matching down to the memory state, answers in Anki arrive, nothing on the second run) | Anki 25.9.4 (WSL, headless), local Cloudflare | Passed |
| Step 8-A's `after_anki_sync` (syncs right after the signal that Anki's sync finished; doesn't run when off; doesn't run while closing; doesn't run twice) | Same as above. It was tested without syncing to AnkiWeb, only emitting the finished signal | Passed |
| Which side is kept in sync (9 scenarios: answered, answered in Anki, only recalculated, only logs went in and stopped, undone, marks and so on), and the server discarding a change that knows only an old answer | The add-on's rules directly, local Cloudflare | Passed |
| Steps 2 to 6 and 8-B (write-back was tested with a dry run and with writing using a stand-in for AnkiConnect) | Ubuntu on WSL, Python 3.12, Cloudflare (made for the test and deleted), a sample collection | Passed |
| Export and build for Steps 1 to 3 and 5, and `setup_windows.bat` | Windows 11, Python 3.14 | Passed |
| Step 9 (after changing contents in Anki, adding cards, moving decks and deleting notes, then rebuilding) | WSL, local Cloudflare, Chromium (reopened on a device that held the previous contents) | Passed (all 4 reflected. The state of answers made on the device also stayed) |
| How to include features the official app doesn't have (none / sample design / sample + Auto sync), and sync only when pressed | Local Cloudflare (wrangler pages dev), Chromium | Passed |
| Display language (English, German, Chinese) | Same as above | Passed (for the app's own text, anything Anki has no translation for is English) |
| Building the shell (Step 7) and installing with iloader | iPad | Passed (the version where you enter the code is unconfirmed) |
| `--check` and `--force` of Step 7-3 (automatic reinstall) | Windows 11, iPad (over Wi-Fi only) | Passed (it opened without "Trust" and the data stayed). `--force` and the task registration were with a version from before it was put in this repository; for the version after, only `--check` (no IPA, a mistake in the config, run twice at once, the remembered device not visible). Automatic reinstall before the deadline, and the notification appearing on screen, are unconfirmed |
| iPhone, and Mac and Linux desktops | — | Unconfirmed. It worked in Chrome on Android |

## A. Downgrade AnkiMobile

AnkiMobile 26.10 greatly changed the look of the browser and the deck list ([announcement](https://forums.ankiweb.net/t/ankimobile-26-10-is-out/74202)). The Anki team says rolling it back isn't realistic ([response](https://forums.ankiweb.net/t/anki-team-response-to-feedback-about-ankimobile-26-10/74500)). The App Store also has no screen for choosing and installing an older version ([forum answer](https://forums.ankiweb.net/t/undo-26-10-update/74279)).

Among users, a method using ipatool (a tool that downloads past versions of an app you bought with your own Apple ID from the App Store) is used to roll back. We confirmed that this method can overwrite 26.10 with 25.09 from Windows. It is an unofficial method that neither Apple nor Anki guarantees, so use it at your own risk.

What you need:
- You have already purchased AnkiMobile with that Apple ID. The IPA you download is for that Apple ID, so don't distribute it to others
- A computer (Windows, Mac or Linux) and a USB cable. Connect the iPhone/iPad and tap "Trust This Computer"
- On Windows, iTunes (the Microsoft Store version is fine). Launch it once and accept the license agreement. Until you do, the component that communicates with the iPhone/iPad may not work
- Python 3 (for pymobiledevice3)

Steps:
1. Take a backup first. Sync with AnkiWeb, or export a backup with AnkiMobile's feature
2. Turn off automatic updates. "Settings" → "App Store" → turn off "App Updates". If you forget, it goes back to the new version overnight
3. Install ipatool. Download the one for your OS from <https://github.com/majd/ipatool/releases> and extract it. Use 2.8.0 or later (with 2.7.0, sign-in sometimes failed)
4. Sign in. Enter the password and the two-factor code yourself
   ```
   ipatool auth login -e your-Apple-ID-email-address
   ```
   If `The specified item could not be found in the keyring` appears on Windows, add `--keychain-passphrase any-string` to all later ipatool commands. This string stays in the command history, so don't use a password you use elsewhere
5. Look up the version identifier
   ```
   ipatool list-versions -b net.ichi2.anki
   ipatool get-version-metadata -b net.ichi2.anki --external-version-id identifier
   ```
   Identifiers we confirmed (from the App Store's version information):

   | Version | Identifier | Date in the version information |
   |---|---|---|
   | 26.10 | 894175942 | 2026-10-21 |
   | 25.09 | 877897364 | 2025-09-06 |
   | 25.07.1 | 876758655 | 2025-07-28 |
   | 25.07 | 876569007 | 2025-07-21 |
   | 25.02.2 | 872747305 | 2025-02-24 |
6. Download
   ```
   ipatool download -b net.ichi2.anki --external-version-id 877897364 -o AnkiMobile_25.09.ipa
   ```
   `"success":true` means success. If you have already purchased it, `"purchased":false` (no new purchase) appears
7. Overwrite over USB
   ```
   python -m pip install pymobiledevice3
   python -m pymobiledevice3 apps install AnkiMobile_25.09.ipa
   ```
   `Installation succeed.` means it's done. We confirmed that your decks and records stay after overwriting, but keep the backup from step 1
8. Go to "Settings" → "General" → "iPhone (iPad) Storage" → "AnkiMobile" and check that the version is 25.09

- It is an IPA signed by the App Store, so we think Developer Mode isn't needed, but we haven't tried it on a device where it is off
- The official docs say newer versions sometimes depend on changes to the sync mechanism ([sync server explanation](https://docs.ankiweb.net/manual/sync-server.md)). How long an old version can sync with AnkiWeb is unknown

## B. Downgrade Anki desktop

From the official manual ([Installing](https://docs.ankiweb.net/manual/platform/windows/installing.md), [Profiles](https://docs.ankiweb.net/manual/profiles.md)).

1. Take a backup first, and in the current version choose "File" → "Switch Profile" → "Downgrade & Quit". If you don't, opening in the older version may give an error
2. Get the old version from <https://github.com/ankitects/anki/releases>
   - From 25.07 on, you can choose the version in Anki under "Tools" → "Upgrade/Downgrade" ([25.07 release notes](https://github.com/ankitects/anki/releases/tag/25.07))
   - For 25.09.x, install `anki-launcher-25.09-…` from the [25.09 release](https://github.com/ankitects/anki/releases/tag/25.09) (.exe on Windows, .dmg on Mac), then choose with "Upgrade/Downgrade" (the 25.09.4 release has no files attached)
   - We haven't confirmed whether you can go from 26.x back to 25.09.x this way

If you only want to use this app, you don't need to roll back Anki on your computer. The tools separately use Python anki 25.9.4 (we confirmed that a test collection made with Anki 26.09.4 can be opened with 25.9.4; that was the only one checked).

## C. Downgrade AnkiDroid

AnkiDroid distributes all past versions as APKs ([releases](https://github.com/ankidroid/Anki-Android/releases), [wiki FAQ](https://github.com/ankidroid/Anki-Android/wiki/FAQ)). Android can't overwrite an installed app with an older version ([Android's explanation](https://developer.android.com/studio/publish/versioning)), so do one of the following.

- Install the Parallel version the wiki recommends (the APK marked with a letter such as A) and use it side by side with the current version
- First sync with AnkiWeb or take a backup, then uninstall the current version and install the old one. If you choose "Delete data" when uninstalling, the data is deleted

---

## License

AGPL-3.0-or-later (`LICENSE`). See `NOTICE.md` for the origins.
