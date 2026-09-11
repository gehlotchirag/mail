import { Capacitor } from "@capacitor/core";

/**
 * Saves/opens a blob on-device via Android's native share sheet.
 *
 * Why this exists: attachment "view" and "download" both worked by creating
 * a `blob:` object URL and either `window.open`-ing it or clicking a hidden
 * `<a download>` pointed at it. Both of those rely on machinery a real
 * browser provides — a tabbed window to open into, and a download manager
 * wired up to blob: URLs. Capacitor's embedded Android WebView has neither,
 * so both calls silently do nothing: no error, no crash, just no visible
 * result. That is the entire bug — every attachment in the mobile app, in
 * any folder including Sent, went through one of these two calls.
 *
 * The fix is the standard Capacitor pattern for this exact situation: write
 * the blob to the app's cache directory with @capacitor/filesystem, then
 * hand that file's URI to @capacitor/share, which opens the native Android
 * share sheet. Its "Open with" covers viewing (any installed viewer for the
 * file's type), and "Save to Files"/Drive/etc. covers downloading — one
 * native affordance serves both intents at once.
 *
 * No-ops (returns false) outside a native shell so every call site keeps its
 * existing browser behavior unchanged on the web and desktop.
 */
export async function openOrSaveNative(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const base64 = await blobToBase64(blob);
  // Filesystem paths are flat inside the target directory — strip anything
  // that looks like a path separator so a crafted attachment name can't
  // escape the cache dir, and fall back to a plain name if that empties it.
  const safeName = filename.replace(/[/\\]+/g, "_").trim() || "download";

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader.readAsDataURL prefixes "data:<mime>;base64,"; Filesystem.writeFile wants the raw payload.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}
