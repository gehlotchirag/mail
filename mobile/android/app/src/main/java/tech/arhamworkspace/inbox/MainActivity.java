package tech.arhamworkspace.inbox;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // SaveFilePlugin is app-local (not an npm package), so it isn't picked
    // up by Capacitor's plugin auto-discovery the way @capacitor/* plugins
    // are — it has to be registered explicitly, before super.onCreate()
    // builds the bridge.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
