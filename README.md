# FlashDesk Player

A Windows desktop SWF player with audio controls and a picture-enhancement panel. It opens in its own app window and uses the open-source Ruffle Flash emulator to run movies.

## Install the standalone app

Run **FlashDesk-Player-Setup-1.0.12.exe** from the deliverables folder. The installed app runs without Node.js.

## Run from source

1. Install Node.js 22 or newer (npm is included).
2. Double-click `Run FlashDesk.cmd` for first-time setup and launch, or run `npm install` followed by `npm start` in this folder.

The Ruffle engine is loaded from its official CDN when the app starts, so an internet connection is needed for SWF playback. The movie itself is opened from your computer.

## Build a Windows installer

Run `npm run build:windows`. The installer will be created in `release/`.

## App updates

FlashDesk checks the public GitHub Releases feed at `izik1333/FlashDesk-Player`. The packaged app includes the feed configuration; releases should include the generated installer, `latest.yml`, and blockmap so the in-app update button can find and install newer versions.

## Controls

- **Open SWF** or **Ctrl+O**: choose a movie.
- The **Play** button reopens the most recently played SWF. FlashDesk keeps that one recent game locally on this device; if there is no recent game, Play opens the file picker.
- Tap the **+** button next to a loaded game's name to save it in the Library. Use the star to favorite it, the picture button to choose an image (animated GIF covers stay animated), the camera button for a still screenshot, or **GIF** to record a four-second animated cover from the game. Use **Area** first to draw a box directly over the live game; the saved GIF records exactly that part of the screen and preserves its aspect ratio. GIF max size sets its longest edge. The fullscreen toolbar also has screenshot and GIF capture buttons. Library entries keep a local copy of each saved SWF and its cover on this device, so they can be reopened later.
- Drag and drop a `.swf` file into the player window.
- **Space**: play or pause.
- **M**: mute or unmute.
- Use the **Library** tab to browse saved games, filter favorites, change favorite status, and remove entries. Choose large thumbnails, normal thumbnails, a column layout, or a compact list with the layout buttons; FlashDesk remembers your choice. Select a card to start its game; use **Player** to return to the game screen.
- For supported games, the **Scenes** menu provides game-specific scene shortcuts in both windowed and fullscreen play.
- Use the settings panel for game and animation picture adjustments, brightness, contrast, color, crisp pixel scaling, presets, volume, and update checks.
- Resolution scaling supports fit, stretch, crop, and original size. Render quality can be set to high, balanced, or fast; changing either restarts the currently loaded game after confirmation.
- Crisp pixel scaling and the separate game color enhancer apply to Ruffle's rendered canvas, including fullscreen games.

Picture enhancement applies display filters to the emulator's output, including games. It does not modify the SWF file. Ruffle supports a large portion of Flash content, but compatibility varies by game.
