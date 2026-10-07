import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { api, native } from "../lib/api";
import { Button } from "./ui/button";
import { message } from "../lib/utils";

const CHECK_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 15 * 60_000;
const RETRY_DELAY = 1500;

// Updater failures arrive as raw transport/OS strings. Say what the user can
// do, and keep the original text for bug reports. First match wins.
const HINTS: [RegExp, string][] = [
  [
    /os error (30|18)\b|read-only file system|cross-device|AppTranslocation/i,
    "Git Context is running from a disk image or another read-only location. Move it to your Applications folder, reopen it and try again.",
  ],
  [
    /signature|minisign|public key/i,
    "The download could not be verified, so nothing was installed. Try again or install the release manually.",
  ],
  [
    /permission denied|access is denied|os error (13|5)\b|move the new app into place|authenticat|pkexec/i,
    "Git Context could not replace the installed app. Approve the administrator prompt, or install the release manually.",
  ],
  [
    /platform|unsupported os/i,
    "This release has no in-app update for your installation type. Install the release manually.",
  ],
  [
    /timed? ?out|sending request|dns|connect|network|certificate|tls|status: \d{3}|release json|decoding response/i,
    "The update server could not be reached. Check your internet connection, proxy or firewall, then try again.",
  ],
];
export function explainUpdateError(error: unknown) {
  const raw = message(error);
  const hint = HINTS.find(([pattern]) => pattern.test(raw))?.[1];
  return hint ? `${hint} (${raw})` : raw;
}

// Cleanup must never turn a successful install/check into an apparent failure.
async function releaseUpdate(update: Update | null | undefined) {
  try {
    await update?.close();
  } catch {
    // The backend may already have released the resource during shutdown.
  }
}

export function Updates() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restart, setRestart] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const lock = useRef(false);
  const installed = useRef(false);
  const current = useRef<Update | null>(null);
  const mounted = useRef(true);
  // Automatic checks stay quiet on failure: being offline at launch is not
  // something the user asked about.
  const checkUpdates = useCallback(async (automatic = false) => {
    if (!native || lock.current || installed.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!(await api.updaterReady())) {
        if (mounted.current)
          setStatus(
            "Automatic updates will be available in a release configured for signed updates.",
          );
        return;
      }
      if (!automatic && mounted.current) {
        setFailed(false);
        setStatus("Checking for updates…");
      }
      let next: Update | null;
      try {
        next = await check({ timeout: CHECK_TIMEOUT });
      } catch {
        // One retry covers a dropped connection or a slow first DNS lookup.
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        next = await check({ timeout: CHECK_TIMEOUT });
      }
      if (!mounted.current) {
        await releaseUpdate(next);
        return;
      }
      await releaseUpdate(current.current);
      current.current = next;
      setUpdate(next);
      setFailed(false);
      setStatus(
        next ? `Version ${next.version} is available` : "You’re up to date.",
      );
    } catch (e) {
      if (mounted.current && !automatic) {
        setFailed(true);
        setStatus(`Could not check for updates. ${explainUpdateError(e)}`);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (native)
      void api
        .shortcutStatus()
        .then(setShortcutError)
        .catch(() => {});
    const timer = setTimeout(() => void checkUpdates(true), 8000);
    const interval = setInterval(
      () => void checkUpdates(true),
      24 * 60 * 60 * 1000,
    );
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      clearInterval(interval);
      void releaseUpdate(current.current);
      current.current = null;
    };
  }, [checkUpdates]);
  return (
    <details className="app-tools" open={update ? true : undefined}>
      <summary>
        {update
          ? `Update available · ${update.version}`
          : "Quick switch & app updates"}
      </summary>
      <p>
        Quick switch from any app: <kbd>⌘ / Ctrl Shift G</kbd>. Escape dismisses
        the picker.
      </p>
      {shortcutError && (
        <p role="alert" className="inline-error">
          Shortcut unavailable: {shortcutError}. Close the app using this
          shortcut, then restart Git Context.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {update?.body && <pre className="release-notes">{update.body}</pre>}
      <div className="row">
        <Button
          size="sm"
          variant="outline"
          disabled={!native || busy}
          onClick={() => void checkUpdates()}
        >
          Check for updates
        </Button>
        {update && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setFailed(false);
              try {
                setStatus("Downloading update…");
                let total = 0;
                let received = 0;
                let shown = -1;
                await update.downloadAndInstall(
                  (event) => {
                    if (event.event === "Started")
                      total = event.data.contentLength ?? 0;
                    else if (event.event === "Progress") {
                      received += event.data.chunkLength;
                      const percent = total
                        ? Math.min(99, Math.floor((received / total) * 100))
                        : -1;
                      if (percent > shown) {
                        shown = percent;
                        setStatus(`Downloading update… ${percent}%`);
                      }
                    } else
                      setStatus("Download complete. Installing signed update…");
                  },
                  { timeout: DOWNLOAD_TIMEOUT },
                );
                setStatus(
                  "Update installed. Restart Git Context to start using the new version.",
                );
                installed.current = true;
                setRestart(true);
                await releaseUpdate(update);
                current.current = null;
                setUpdate(null);
              } catch (e) {
                setFailed(true);
                setStatus(`Update failed. ${explainUpdateError(e)}`);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            Install update
          </Button>
        )}
        {restart && (
          <Button
            size="sm"
            onClick={() =>
              void api
                .restartApp()
                .catch(() =>
                  setStatus(
                    "Could not restart automatically. Choose Quit Git Context Completely from the tray/menu bar, then reopen Git Context.",
                  ),
                )
            }
          >
            Restart now
          </Button>
        )}
        {failed && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void api
                .openReleases()
                .catch((e) =>
                  setStatus(`Could not open the browser. ${message(e)}`),
                )
            }
          >
            Download manually
          </Button>
        )}
      </div>
    </details>
  );
}
