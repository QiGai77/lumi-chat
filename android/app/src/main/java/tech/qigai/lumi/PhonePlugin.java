package tech.qigai.lumi;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** JS 侧的 LumiPhone：无障碍操控、自建 ADB、手机存储文件夹（SAF）。 */
@CapacitorPlugin(name = "LumiPhone")
public class PhonePlugin extends Plugin {

    @Override public void load() {
        LumiPair.listener = (state, msg) -> { JSObject o = new JSObject(); o.put("state", state); o.put("msg", msg); notifyListeners("adb", o); };
        // v0.17：Flow 的 AI 视觉步把截图和元素列表交给 JS 调模型，JS 用 flowVisionAnswer 回传
        LumiFlow.visionSink = req -> { try { notifyListeners("flowVision", JSObject.fromJSONObject(req)); } catch (Exception ignored) { } };
    }

    private Context ctx() { return getContext(); }
    private LumiA11yService svc(PluginCall call) {
        LumiA11yService s = LumiA11yService.instance;
        if (s == null) call.reject("无障碍服务没打开：到 设置 → 无障碍 → 栖语 Lumi 手机操控 里打开");
        return s;
    }
    private void ok(PluginCall call, boolean ok, String fail) { if (ok) { JSObject o = new JSObject(); o.put("ok", true); call.resolve(o); } else call.reject(fail); }

    /* ---------- 无障碍 */
    @PluginMethod public void a11yStatus(PluginCall call) {
        boolean on = LumiA11yService.instance != null;
        if (!on) {
            String list = Settings.Secure.getString(ctx().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            on = list != null && list.contains(new ComponentName(ctx(), LumiA11yService.class).flattenToString()) && LumiA11yService.instance != null;
        }
        JSObject o = new JSObject(); o.put("enabled", on); call.resolve(o);
    }
    @PluginMethod public void openA11ySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx().startActivity(i); call.resolve();
    }
    @PluginMethod public void screen(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        JSObject o = new JSObject(); o.put("text", s.dump(call.getInt("max", 160))); call.resolve(o);
    }
    @PluginMethod public void click(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        int id = call.getInt("id", -1);
        org.json.JSONObject sel = s.selFor(id);
        if (!s.click(id, call.getBoolean("long", false))) { call.reject("点不到这个元素，先重新读一下屏幕"); return; }
        JSObject o = new JSObject(); o.put("ok", true);
        if (sel != null) try { o.put("step", JSObject.fromJSONObject(sel)); } catch (Exception ignored) { }
        call.resolve(o);
    }
    @PluginMethod public void inputInfo(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        org.json.JSONObject sel = s.selFor(call.getInt("id", -1));
        JSObject o = new JSObject();
        if (sel != null) try { o.put("step", JSObject.fromJSONObject(sel)); } catch (Exception ignored) { }
        call.resolve(o);
    }

    /* ---------- Flow */
    @PluginMethod public void flowRun(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        final String name = call.getString("name", "Flow");
        final org.json.JSONArray steps = call.getArray("steps", new JSArray());
        final org.json.JSONObject vars = call.getObject("vars", new JSObject());
        LumiAdb.IO.execute(() -> {
            try { call.resolve(JSObject.fromJSONObject(s.flow.run(name, steps, call.getBoolean("fast", true), vars))); }
            catch (Throwable e) { call.reject("Flow 运行出错：" + e.getMessage()); }
        });
    }
    @PluginMethod public void flowVisionAnswer(PluginCall call) {
        LumiA11yService s = LumiA11yService.instance;
        if (s != null && s.flow != null) s.flow.answerVision(call.getData());
        call.resolve();
    }
    @PluginMethod public void flowStop(PluginCall call) { LumiA11yService s = LumiA11yService.instance; if (s != null && s.flow != null) { s.flow.stop = true; s.flow.cancelVision(); } call.resolve(); }
    @PluginMethod public void recordStart(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        s.flow.recordStart(call.getString("pkg", ""), call.getString("app", ""));
        call.resolve();
    }
    @PluginMethod public void recordStatus(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        JSObject o = new JSObject(); o.put("recording", s.flow.recording);
        try { o.put("steps", new JSArray(s.flow.recorded().toString())); } catch (Exception ignored) { }
        call.resolve(o);
    }
    @PluginMethod public void recordStop(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        s.flow.recording = false; s.flow.hideBar(0);
        JSObject o = new JSObject();
        try { o.put("steps", new JSArray(s.flow.recorded().toString())); } catch (Exception ignored) { }
        call.resolve(o);
    }
    @PluginMethod public void tap(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        ok(call, s.tap(call.getInt("x", 0), call.getInt("y", 0), call.getBoolean("long", false) ? 700 : 60), "点击失败");
    }
    @PluginMethod public void swipe(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        ok(call, s.swipe(call.getInt("x1", 0), call.getInt("y1", 0), call.getInt("x2", 0), call.getInt("y2", 0), call.getInt("ms", 300)), "滑动失败");
    }
    @PluginMethod public void input(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        ok(call, s.input(call.getInt("id", -1), call.getString("text", "")), "找不到输入框，先点一下输入框再试");
    }
    @PluginMethod public void scroll(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        ok(call, s.scroll(call.getInt("id", 0), call.getBoolean("forward", true)), "这里不能滚动");
    }
    @PluginMethod public void global(PluginCall call) {
        LumiA11yService s = svc(call); if (s == null) return;
        ok(call, s.global(call.getString("action", "")), "不支持这个操作");
    }

    /* ---------- 应用 */
    @PluginMethod public void apps(PluginCall call) {
        String q = call.getString("q", "").toLowerCase();
        PackageManager pm = ctx().getPackageManager();
        List<ResolveInfo> l = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
        JSArray arr = new JSArray();
        for (ResolveInfo r : l) {
            String label = String.valueOf(r.loadLabel(pm)), pkg = r.activityInfo.packageName;
            if (!q.isEmpty() && !label.toLowerCase().contains(q) && !pkg.toLowerCase().contains(q)) continue;
            JSObject o = new JSObject(); o.put("label", label); o.put("pkg", pkg); arr.put(o);
            if (arr.length() >= 60) break;
        }
        JSObject o = new JSObject(); o.put("apps", arr); call.resolve(o);
    }
    /** 应用的原生启动图标 → PNG data URL（v0.20）。
     * 先按包名找（有启动入口才算），找不到再按应用名在启动器列表里找：完全相同 > 名字包含 > 被名字包含（≥2 字）。
     * 取启动 Activity 的图标（和桌面上看到的一致），自适应图标（API 26+）手动把背景层和前景层画进圆角方形里，
     * 其他图标按 intrinsic 尺寸等比画进 160px 位图；画出来全透明就退回 Drawable.draw。 */
    @PluginMethod public void appIcon(PluginCall call) {
        String pkg = call.getString("pkg", ""), name = call.getString("name", "");
        if (pkg == null) pkg = "";
        if (name == null) name = "";
        PackageManager pm = ctx().getPackageManager();
        try {
            ComponentName comp = null;
            if (!pkg.isEmpty()) {
                Intent li = pm.getLaunchIntentForPackage(pkg);
                if (li != null) comp = li.getComponent();
                else { try { pm.getApplicationInfo(pkg, 0); } catch (PackageManager.NameNotFoundException e) { pkg = ""; } }
            }
            if (pkg.isEmpty() && !name.trim().isEmpty()) {
                String want = norm(name);
                int best = 0;
                for (ResolveInfo r : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)) {
                    String label = norm(String.valueOf(r.loadLabel(pm)));
                    int score = label.equals(want) ? 3 : label.contains(want) ? 2 : (label.length() >= 2 && want.contains(label)) ? 1 : 0;
                    if (score > best) { best = score; pkg = r.activityInfo.packageName; comp = new ComponentName(r.activityInfo.packageName, r.activityInfo.name); if (score == 3) break; }
                }
            }
            if (pkg.isEmpty()) { call.reject("没找到应用"); return; }
            android.graphics.drawable.Drawable d = null;
            if (comp != null) { try { d = pm.getActivityIcon(comp); } catch (Exception ignored) { } }
            if (d == null) d = pm.getApplicationIcon(pkg);
            android.graphics.Bitmap bm = renderIcon(d, 160);
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bo);
            JSObject o = new JSObject();
            o.put("pkg", pkg); o.put("label", String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0))));
            o.put("src", "data:image/png;base64," + android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
            call.resolve(o);
        } catch (Exception e) { call.reject("读不到图标：" + e.getMessage()); }
    }
    private static String norm(String s) { return s == null ? "" : s.replaceAll("[\\s\\u00a0\\u200b]+", "").toLowerCase(java.util.Locale.ROOT); }

    /** 把图标画成 sz×sz 的位图。自适应图标：两层各占 1.5 倍可见区（108dp / 72dp），裁成 22% 圆角的方形。 */
    static android.graphics.Bitmap renderIcon(android.graphics.drawable.Drawable d, int sz) {
        android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(sz, sz, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas c = new android.graphics.Canvas(bm);
        if (Build.VERSION.SDK_INT >= 26 && d instanceof android.graphics.drawable.AdaptiveIconDrawable) {
            android.graphics.drawable.AdaptiveIconDrawable a = (android.graphics.drawable.AdaptiveIconDrawable) d;
            android.graphics.Path mask = new android.graphics.Path();
            float r = sz * 0.22f;
            mask.addRoundRect(new android.graphics.RectF(0, 0, sz, sz), r, r, android.graphics.Path.Direction.CW);
            c.save(); c.clipPath(mask);
            int pad = sz / 4;
            android.graphics.drawable.Drawable bg = a.getBackground(), fg = a.getForeground();
            if (bg != null) { bg.setBounds(-pad, -pad, sz + pad, sz + pad); bg.draw(c); } else c.drawColor(android.graphics.Color.WHITE);
            if (fg != null) { fg.setBounds(-pad, -pad, sz + pad, sz + pad); fg.draw(c); }
            c.restore();
        } else {
            int w = d.getIntrinsicWidth(), h = d.getIntrinsicHeight();
            if (w <= 0 || h <= 0) { w = sz; h = sz; }
            float k = Math.min((float) sz / w, (float) sz / h);
            int dw = Math.round(w * k), dh = Math.round(h * k), x = (sz - dw) / 2, y = (sz - dh) / 2;
            d.setBounds(x, y, x + dw, y + dh); d.draw(c);
        }
        if (blank(bm)) { bm.eraseColor(android.graphics.Color.TRANSPARENT); d.setBounds(0, 0, sz, sz); d.draw(c); }
        return bm;
    }
    private static boolean blank(android.graphics.Bitmap bm) {
        int w = bm.getWidth(), h = bm.getHeight();
        for (int y = 0; y < h; y += 8) for (int x = 0; x < w; x += 8) if ((bm.getPixel(x, y) >>> 24) > 16) return false;
        return true;
    }
    @PluginMethod public void launch(PluginCall call) {
        String name = call.getString("name", "").trim();
        PackageManager pm = ctx().getPackageManager();
        Intent i = pm.getLaunchIntentForPackage(name);
        if (i == null) {
            for (ResolveInfo r : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)) {
                String label = String.valueOf(r.loadLabel(pm));
                if (label.equalsIgnoreCase(name) || label.contains(name)) { i = pm.getLaunchIntentForPackage(r.activityInfo.packageName); if (label.equalsIgnoreCase(name)) break; }
            }
        }
        if (i == null) { call.reject("没找到应用「" + name + "」"); return; }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        ctx().startActivity(i);
        JSObject o = new JSObject(); o.put("ok", true); o.put("pkg", i.getPackage() == null && i.getComponent() != null ? i.getComponent().getPackageName() : i.getPackage()); call.resolve(o);
    }
    @PluginMethod public void openUrl(PluginCall call) {
        try { ctx().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", ""))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(); }
        catch (Exception e) { call.reject("打不开这个链接"); }
    }

    /* ---------- ADB */
    @PluginMethod public void adbStatus(PluginCall call) {
        boolean con = false;
        try { con = LumiAdb.get(ctx()).isConnected(); } catch (Throwable ignored) { }
        JSObject o = new JSObject(); o.put("connected", con); o.put("pairPort", LumiPair.pairPort); o.put("connectPort", LumiPair.connectPort); o.put("last", LumiPair.lastResult);
        o.put("sdk", Build.VERSION.SDK_INT); call.resolve(o);
    }
    @PluginMethod public void openDevSettings(PluginCall call) {
        try { ctx().startActivity(new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { ctx().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        call.resolve();
    }
    /** 不带参数：开始自动发现 + 通知栏输入配对码；带 port + code：直接配对（分屏时用）。 */
    @PluginMethod public void adbPair(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && getActivity() != null)
            ActivityCompat.requestPermissions(getActivity(), new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 73);
        Integer port = call.getInt("port"); String code = call.getString("code");
        if (port != null && port > 0 && !TextUtils.isEmpty(code)) LumiPair.pair(ctx(), port, code);
        else LumiPair.start(ctx());
        call.resolve();
    }
    @PluginMethod public void adbConnect(PluginCall call) {
        Integer port = call.getInt("port");
        final Context c = ctx();
        LumiPair.watchConnect(c);
        LumiAdb.IO.execute(() -> {
            try {
                LumiAdb a = LumiAdb.get(c);
                boolean con = a.isConnected();
                if (!con && port != null && port > 0) con = a.connect("127.0.0.1", port);
                if (!con) con = a.autoConnect(c, 8000);
                if (!con && LumiPair.connectPort > 0) con = a.connect("127.0.0.1", LumiPair.connectPort);
                if (!con) { try { con = a.connect("127.0.0.1", 5555); } catch (Throwable ignored) { } }
                if (con) { JSObject o = new JSObject(); o.put("connected", true); call.resolve(o); }
                else call.reject("连不上：确认已打开无线调试并配对过；或者用电脑执行一次 adb tcpip 5555");
            } catch (Throwable e) { call.reject("连接失败：" + e.getMessage()); }
        });
    }
    @PluginMethod public void adbDisconnect(PluginCall call) {
        try { LumiAdb.get(ctx()).disconnect(); } catch (Throwable ignored) { }
        call.resolve();
    }
    @PluginMethod public void adbShell(PluginCall call) {
        final String cmd = call.getString("cmd", "");
        final long timeout = call.getInt("timeout", 20000);
        final Context c = ctx();
        LumiAdb.IO.execute(() -> {
            try {
                LumiAdb a = LumiAdb.get(c);
                if (!a.isConnected() && !a.autoConnect(c, 6000)) { call.reject("ADB 没连接，先到「手机连接」里连上"); return; }
                JSObject o = new JSObject(); o.put("out", a.shell(cmd, timeout)); call.resolve(o);
            } catch (Throwable e) { call.reject("执行失败：" + e.getMessage()); }
        });
    }

    /* ---------- 手机存储文件夹（SAF） */
    private SharedPreferences prefs() { return ctx().getSharedPreferences("lumi_storage", Context.MODE_PRIVATE); }
    private DocumentFile root() {
        String u = prefs().getString("tree", null);
        if (u == null) return null;
        DocumentFile d = DocumentFile.fromTreeUri(ctx(), Uri.parse(u));
        return d != null && d.canWrite() ? d : null;
    }
    @PluginMethod public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "folderPicked");
    }
    @ActivityCallback private void folderPicked(PluginCall call, ActivityResult r) {
        if (call == null) return;
        if (r.getResultCode() != android.app.Activity.RESULT_OK || r.getData() == null || r.getData().getData() == null) { call.reject("没有选择文件夹"); return; }
        Uri u = r.getData().getData();
        try { ctx().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) { }
        prefs().edit().putString("tree", u.toString()).apply();
        folderStatus(call);
    }
    @PluginMethod public void folderStatus(PluginCall call) {
        DocumentFile d = root();
        JSObject o = new JSObject(); o.put("linked", d != null);
        if (d != null) { String p = Uri.decode(String.valueOf(d.getUri())); int k = p.lastIndexOf(':'); o.put("name", k >= 0 ? p.substring(k + 1) : d.getName()); }
        call.resolve(o);
    }
    @PluginMethod public void unlinkFolder(PluginCall call) { prefs().edit().remove("tree").apply(); call.resolve(); }

    private DocumentFile walk(String path, boolean create, boolean dirLeaf) {
        DocumentFile cur = root();
        if (cur == null) return null;
        String[] parts = path.replace('\\', '/').replaceAll("^/+|/+$", "").split("/");
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i].replaceAll("[:*?\"<>|]", "_");
            if (p.isEmpty() || p.equals(".") || p.equals("..")) continue;
            boolean leaf = i == parts.length - 1;
            DocumentFile next = cur.findFile(p);
            if (next == null) {
                if (!create) return null;
                next = leaf && !dirLeaf ? cur.createFile(mime(p), p) : cur.createDirectory(p);
                if (next == null) return null;
            }
            cur = next;
        }
        return cur;
    }
    private static String mime(String n) {
        String l = n.toLowerCase();
        if (l.endsWith(".html") || l.endsWith(".htm")) return "text/html";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".md")) return "text/markdown";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".js")) return "text/javascript";
        if (l.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }
    @PluginMethod public void writeText(PluginCall call) {
        final String path = call.getString("path", ""), text = call.getString("text", "");
        LumiAdb.IO.execute(() -> {
            try {
                if (root() == null) { call.reject("还没有选择手机存储文件夹"); return; }
                DocumentFile f = walk(path, true, false);
                if (f == null || f.isDirectory()) { call.reject("写不进去：" + path); return; }
                try (OutputStream o = ctx().getContentResolver().openOutputStream(f.getUri(), "wt")) { o.write(text.getBytes(StandardCharsets.UTF_8)); }
                JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
            } catch (Throwable e) { call.reject("保存失败：" + e.getMessage()); }
        });
    }
    @PluginMethod public void readText(PluginCall call) {
        final String path = call.getString("path", "");
        LumiAdb.IO.execute(() -> {
            try {
                DocumentFile f = walk(path, false, false);
                if (f == null || f.isDirectory()) { call.reject("文件不存在：" + path); return; }
                StringBuilder sb = new StringBuilder();
                try (InputStream in = ctx().getContentResolver().openInputStream(f.getUri()); BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                    char[] b = new char[8192]; int n; while ((n = r.read(b)) > 0 && sb.length() < 400000) sb.append(b, 0, n);
                }
                JSObject o = new JSObject(); o.put("text", sb.toString()); call.resolve(o);
            } catch (Throwable e) { call.reject("读取失败：" + e.getMessage()); }
        });
    }
    @PluginMethod public void list(PluginCall call) {
        final String path = call.getString("path", "");
        LumiAdb.IO.execute(() -> {
            try {
                DocumentFile d = path.isEmpty() ? root() : walk(path, false, true);
                JSArray arr = new JSArray();
                if (d != null && d.isDirectory()) for (DocumentFile f : d.listFiles()) {
                    JSObject o = new JSObject(); o.put("name", f.getName()); o.put("dir", f.isDirectory()); o.put("size", f.length()); o.put("mtime", f.lastModified()); arr.put(o);
                }
                JSObject o = new JSObject(); o.put("files", arr); call.resolve(o);
            } catch (Throwable e) { call.reject("读取文件夹失败：" + e.getMessage()); }
        });
    }
    @PluginMethod public void remove(PluginCall call) {
        final String path = call.getString("path", "");
        LumiAdb.IO.execute(() -> { DocumentFile f = walk(path, false, false); if (f != null) f.delete(); call.resolve(); });
    }
}
