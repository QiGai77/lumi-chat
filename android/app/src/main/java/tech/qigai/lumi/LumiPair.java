package tech.qigai.lumi;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Bundle;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * 无线调试配对：用 mDNS 找到本机的配对端口，再发一条带输入框的通知。
 * 用户停在「使用配对码配对设备」弹窗里，下拉通知栏直接填配对码，不用切回应用（切走弹窗会关掉）。
 */
public class LumiPair extends BroadcastReceiver {
    static final String CH = "lumi_adb", ACTION = "tech.qigai.lumi.PAIR", KEY = "code";
    static final int NID = 7301;
    static volatile int pairPort = 0, connectPort = 0;
    static volatile String lastResult = "";
    static NsdManager.DiscoveryListener pairL, connL;
    interface Listener { void on(String state, String msg); }
    static volatile Listener listener;

    static void emit(String state, String msg) { lastResult = state + ":" + msg; Listener l = listener; if (l != null) l.on(state, msg); }

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CH, "无线调试配对", NotificationManager.IMPORTANCE_HIGH);
            c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    static void note(Context c, String title, String text, boolean ask) {
        channel(c);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentTitle(title).setContentText(text).setOnlyAlertOnce(false).setAutoCancel(!ask);
        if (ask) {
            Intent i = new Intent(c, LumiPair.class).setAction(ACTION);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(c, 1, i, fl);
            RemoteInput ri = new RemoteInput.Builder(KEY).setLabel("6 位配对码").build();
            b.addAction(new Notification.Action.Builder(null, "输入配对码", pi).addRemoteInput(ri).build());
        }
        c.getSystemService(NotificationManager.class).notify(NID, b.build());
    }

    static boolean isLocal(InetAddress a) {
        if (a == null) return true;
        try {
            if (a.isLoopbackAddress()) return true;
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces()))
                for (InetAddress x : Collections.list(ni.getInetAddresses())) if (x.equals(a)) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private static NsdManager.DiscoveryListener discover(Context c, String type, boolean pairing) {
        NsdManager nsd = c.getSystemService(NsdManager.class);
        NsdManager.DiscoveryListener l = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int e) { }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceLost(NsdServiceInfo s) { }
            @SuppressWarnings("deprecation")
            @Override public void onServiceFound(NsdServiceInfo s) {
                try {
                    nsd.resolveService(s, new NsdManager.ResolveListener() {
                        @Override public void onResolveFailed(NsdServiceInfo i, int e) { }
                        @Override public void onServiceResolved(NsdServiceInfo i) {
                            if (!isLocal(i.getHost())) return;
                            if (pairing) {
                                if (pairPort != i.getPort()) { pairPort = i.getPort(); note(c, "找到配对服务（端口 " + pairPort + "）", "下拉通知，点「输入配对码」，填弹窗里的 6 位数字", true); emit("found", String.valueOf(pairPort)); }
                            } else connectPort = i.getPort();
                        }
                    });
                } catch (Exception ignored) { }
            }
        };
        try { nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, l); } catch (Exception ignored) { }
        return l;
    }

    static synchronized void start(Context c) {
        c = c.getApplicationContext();
        stop(c);
        pairPort = 0;
        pairL = discover(c, "_adb-tls-pairing._tcp", true);
        connL = discover(c, "_adb-tls-connect._tcp", false);
        note(c, "正在等待配对", "打开 开发者选项 → 无线调试 → 使用配对码配对设备", false);
    }

    static synchronized void stop(Context c) {
        NsdManager nsd = c.getSystemService(NsdManager.class);
        try { if (pairL != null) nsd.stopServiceDiscovery(pairL); } catch (Exception ignored) { }
        pairL = null;
    }

    static void watchConnect(Context c) { if (connL == null) connL = discover(c.getApplicationContext(), "_adb-tls-connect._tcp", false); }

    static void pair(Context c, int port, String code) {
        final Context app = c.getApplicationContext();
        LumiAdb.IO.execute(() -> {
            try {
                emit("pairing", "");
                boolean ok = LumiAdb.get(app).pair("127.0.0.1", port, code.trim());
                if (!ok) throw new Exception("配对码不对或已过期");
                stop(app);
                note(app, "配对成功", "正在连接…", false);
                boolean con = false;
                try { con = LumiAdb.get(app).autoConnect(app, 8000); } catch (Exception ignored) { }
                if (!con && connectPort > 0) try { con = LumiAdb.get(app).connect("127.0.0.1", connectPort); } catch (Exception ignored) { }
                note(app, con ? "已连接 ADB" : "配对成功", con ? "回到栖语 Lumi 就能用了" : "回到栖语 Lumi 点「连接」", false);
                emit(con ? "connected" : "paired", "");
            } catch (Throwable e) {
                note(app, "配对失败", String.valueOf(e.getMessage()), pairPort > 0);
                emit("error", String.valueOf(e.getMessage()));
            }
        });
    }

    @Override public void onReceive(Context c, Intent i) {
        Bundle r = RemoteInput.getResultsFromIntent(i);
        CharSequence code = r == null ? null : r.getCharSequence(KEY);
        if (code == null || pairPort == 0) { note(c, "没收到配对码", "再试一次", pairPort > 0); return; }
        note(c, "正在配对…", "端口 " + pairPort, false);
        pair(c, pairPort, code.toString());
    }
}
