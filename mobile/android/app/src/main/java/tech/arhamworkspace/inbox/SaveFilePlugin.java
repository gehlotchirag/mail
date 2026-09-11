package tech.arhamworkspace.inbox;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * Wraps Android's Storage Access Framework "Create Document" picker so a
 * download lands wherever the user picks — Downloads by default — through
 * the OS's own save dialog, not a share sheet full of app icons.
 *
 * Why this plugin exists: since Android 10, and strictly since Android 11
 * (this app targets Android 15 / API 36), an app cannot silently write into
 * a shared folder like Downloads. Neither @capacitor/filesystem nor
 * @capacitor/share expose that picker —
 * Filesystem's Directory.Documents and Directory.ExternalStorage are both
 * documented as "not accessible on Android 11 or newer" — so there is no
 * off-the-shelf way to get this specific, plain "Save As" experience.
 * ACTION_CREATE_DOCUMENT is the only route besides handing the file to
 * another app via Share, which is what webui/lib/native-attachment.ts still
 * uses for "view" — this plugin only replaces the "download" path.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void saveAs(PluginCall call) {
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String data = call.getString("data");

        if (filename == null || data == null) {
            call.reject("filename and data are required");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        // startActivityForResult saves `call` on the bridge itself, so the
        // base64 payload passed in above is still readable from it once
        // handleSaveResult runs — no need to re-thread it through the intent.
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            // User backed out of the picker — not an error, just nothing saved.
            JSObject ret = new JSObject();
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("No destination returned by the save dialog");
            return;
        }

        String data = call.getString("data");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            try (OutputStream out = resolver.openOutputStream(destination)) {
                if (out == null) {
                    call.reject("Could not open the chosen destination for writing");
                    return;
                }
                out.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to write file: " + e.getMessage(), e);
        }
    }
}
