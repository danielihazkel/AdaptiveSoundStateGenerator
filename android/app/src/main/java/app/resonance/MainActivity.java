package app.resonance;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.resonance.incoming.IncomingPlugin;
import app.resonance.session.SessionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before the bridge is created.
        registerPlugin(SessionPlugin.class);
        registerPlugin(IncomingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
