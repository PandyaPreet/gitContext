## Git Context v0.1.4

Profile switching from the keyboard shortcut is now silent on macOS.

### What's fixed

- Pressing **Command+Shift+G** from another app and choosing a profile no longer opens the main Git Context window. The picker closes, focus returns to the app you were using, and the menu bar shows the new profile.
- If the main window was open in the background, it remains open and reappears when you return to Git Context.
- Windows and Linux behaviour is unchanged.

### Updating

Use **Check for updates** in the app, or install the matching v0.1.4 installer from Assets. Unsigned builds require a manual installation.

### Downloads

Expand **Assets** and choose the installer matching your operating system and processor:

| Platform | Download |
| --- | --- |
| macOS, Apple Silicon | `.dmg` with `aarch64` |
| macOS, Intel | `.dmg` with `x64` |
| Windows x64 | `x64-setup.exe` or x64 `.msi` |
| Windows ARM64 | `arm64-setup.exe` |
| Ubuntu / Debian | `.deb` with `amd64` or `arm64` |
| Other Linux distributions | `.AppImage` or a compatible `.rpm`, matching your architecture |

The source-code archives are not installers. Updater archives, `.sig` files, and `latest.json` are used by the app's updater.

**Requirements:** Git and OpenSSH installed and available on your `PATH`. Backups and configuration history remain available in Settings. Your SSH private keys stay on your machine.

[User guide](https://github.com/PandyaPreet/GitContext#readme) · [Report an issue](https://github.com/PandyaPreet/GitContext/issues)
