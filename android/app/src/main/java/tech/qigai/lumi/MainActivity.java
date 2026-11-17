package tech.qigai.lumi;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
