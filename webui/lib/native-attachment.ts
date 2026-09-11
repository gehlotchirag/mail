import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * SaveFilePlugin — mobile/android/app/src/main/java/tech/arhamworkspace/inbox/SaveFilePlugin.java.
 *
 * App-local plugin (not an npm package), so it isn't auto-discovered the way
 * @capacitor/* plugins are — it's registered explicitly in MainActivity.
 * Wraps Android's Storage Access Framework "Create Document" picker: a plain
 * system save dialog (pick a folder, confirm a filename), as opposed to
 * @capacitor/share's share sheet, which offers a chooser of apps to hand the
 * file to. This exists because, since Android 10 — strictly since Android 11,
 * and this app targets Android 15 — an app cannot silently write into a
 * shared folder like Downloads; @capacitor/filesystem's Directory.Documents
 * and Directory.ExternalStorage are both documented as "not accessible on
 * Android 11 or newer" for exactly that reason. ACTION_CREATE_DOCUMENT is the
 * only route to a user-visible destination besides handing the file to
 * another app.
 */
interface SaveFilePluginType {
  /** `saved: false` means the user backed out of the picker — not an error. */
  saveAs(options: { filename: string; mimeType: string; data: string }): Promise<{ saved: boolean }>;
}
const SaveFile = registerPlugin<SaveFilePluginType>("SaveFile");

/**
 * Opens a blob on-device via Android's native share sheet — "view" intent.
 *
 * Why this exists: attachment preview worked by `window.open`-ing a `blob:`
 * object URL, which needs a tabbed window to open into — machinery the
 * Capacitor mobile shell's embedded WebView doesn't have, so the call
 * silently did nothing: no error, no crash, just no visible result.
 *
 * The fix is the standard Capacitor pattern for this: write the blob to the
 * app's cache directory with @capacitor/filesystem, then hand that file's
 * URI to @capacitor/share, which opens the native Android share sheet — its
 * "Open with" covers viewing with any installed app for the file's type.
 *
 * No-ops (returns false) outside a native shell so callers keep their
 * existing browser behavior unchanged on the web and desktop.
 */
export async function shareNative(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const base64 = await blobToBase64(blob);
  const safeName = safeFilename(filename);

  const written = await Filesystem.writeFile({
    path: safeName,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    url: written.uri,
    dialogTitle: safeName,
  });

  return true;
}

/**
 * Saves a blob on-device via Android's native "Save As" picker — "download"
 * intent, as distinct from shareNative's "view" intent above. Same
 * underlying problem (no download manager wired to blob: URLs / <a download>
 * in the WebView), different fix: rather than routing every attachment
 * through a share sheet full of app icons, this opens a plain system save
 * dialog, matching what "download" means everywhere else.
 *
 * Returns true once the picker has been shown and resolved, whether or not
 * the user actually saved anything — a cancel is the user's decision, not a
 * failure, and callers should not fall back to the (broken) browser download
 * path after it.
 */
export async function saveNativeAs(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const base64 = await blobToBase64(blob);
  await SaveFile.saveAs({
    filename: safeFilename(filename),
    mimeType: blob.type || "application/octet-stream",
    data: base64,
  });

  return true;
}

function safeFilename(filename: string): string {
  // Flat inside whatever directory receives it — strip anything that looks
  // like a path separator so a crafted attachment name can't escape it, and
  // fall back to a plain name if that empties it.
  return filename.replace(/[/\\]+/g, "_").trim() || "download";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader.readAsDataURL prefixes "data:<mime>;base64,"; both native
      // sides want the raw payload.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}
