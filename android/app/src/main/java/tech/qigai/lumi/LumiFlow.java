package tech.qigai.lumi;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Flow：录制 / 运行一串手机操作。在无障碍服务里执行，切到别的应用也能稳定跑。
 * 步骤 JSON：{kind: launch|tap|input|enter|scroll|swipe|key|wait|sleep, sel:{id,text,desc,cls}, x,y(0-1 比例), text, pkg, key, forward, ms, optional, confirm, note}
 */
public class LumiFlow {
    private final LumiA11yService s;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private View bar; private TextView barText; private TextView btnA, btnB;
    volatile boolean stop = false;
    private volatile CountDownLatch waitUser; private volatile boolean userOk;

    // 录制
    volatile boolean recording = false;
    final List<JSONObject> rec = new ArrayList<>();
    private String lastPkg = ""; private JSONObject pendingInput; 

    LumiFlow(LumiA11yService s) { this.s = s; }

    /* ---------------- 悬浮条 */
    private int dp(int v) { return Math.round(v * s.getResources().getDisplayMetrics().density); }
    private TextView pill(String t, int bg, int fg) {
        TextView b = new TextView(s); b.setText(t); b.setTextColor(fg); b.setTextSize(13); b.setPadding(dp(12), dp(6), dp(12), dp(6));
        GradientDrawable g = new GradientDrawable(); g.setColor(bg); g.setCornerRadius(dp(14)); b.setBackground(g); return b;
    }
    void showBar(String text, String a, Runnable ra, String b, Runnable rb) {
        ui.post(() -> {
            try {
                WindowManager wm = s.getSystemService(WindowManager.class);
                if (bar == null) {
                    LinearLayout l = new LinearLayout(s); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(Gravity.CENTER_VERTICAL);
                    l.setPadding(dp(14), dp(8), dp(8), dp(8));
                    GradientDrawable g = new GradientDrawable(); g.setColor(0xF2141A26); g.setCornerRadius(dp(22)); l.setBackground(g);
                    barText = new TextView(s); barText.setTextColor(Color.WHITE); barText.setTextSize(13); barText.setMaxWidth(dp(190));
                    l.addView(barText);
                    btnA = pill("", 0xFFE0583E, Color.WHITE); btnB = pill("", 0x33FFFFFF, Color.WHITE);
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2); lp.leftMargin = dp(8);
                    l.addView(btnA, lp); l.addView(btnB, new LinearLayout.LayoutParams(lp));
                    WindowManager.LayoutParams p = new WindowManager.LayoutParams(-2, -2,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT);
                    p.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL; p.y = dp(44);
                    bar = l; wm.addView(bar, p);
                }
                barText.setText(text);
                btnA.setVisibility(a == null ? View.GONE : View.VISIBLE); btnA.setText(a == null ? "" : a); btnA.setOnClickListener(v -> { if (ra != null) ra.run(); });
                btnB.setVisibility(b == null ? View.GONE : View.VISIBLE); btnB.setText(b == null ? "" : b); btnB.setOnClickListener(v -> { if (rb != null) rb.run(); });
            } catch (Throwable ignored) { }
        });
    }
    void hideBar(long delay) {
        ui.postDelayed(() -> { try { if (bar != null) s.getSystemService(WindowManager.class).removeView(bar); } catch (Throwable ignored) { } bar = null; }, delay);
    }
    private void bringBack() {
        Intent i = s.getPackageManager().getLaunchIntentForPackage(s.getPackageName());
        if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT); s.startActivity(i); }
    }

    /* ---------------- 选择器 */
    static String textOf(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 3) return "";
        CharSequence t = n.getText(); if (t != null && t.toString().trim().length() > 0) return t.toString().trim();
        CharSequence d = n.getContentDescription(); if (d != null && d.toString().trim().length() > 0) return d.toString().trim();
        for (int i = 0; i < n.getChildCount(); i++) { String x = textOf(n.getChild(i), depth + 1); if (!x.isEmpty()) return x; }
        return "";
    }
    JSONObject selOf(AccessibilityNodeInfo n) {
        JSONObject o = new JSONObject();
        try {
            if (n.getViewIdResourceName() != null) o.put("id", n.getViewIdResourceName());
            CharSequence t = n.getText(), d = n.getContentDescription();
            if (t != null && t.length() > 0 && t.length() < 40 && !n.isEditable()) o.put("text", t.toString().trim());
            else if (!n.isEditable()) { String x = textOf(n, 0); if (!x.isEmpty() && x.length() < 40) o.put("text", x); }
            if (d != null && d.length() > 0 && d.length() < 60) o.put("desc", d.toString().trim());
            if (n.getClassName() != null) { String c = n.getClassName().toString(); o.put("cls", c.substring(c.lastIndexOf('.') + 1)); }
        } catch (Exception ignored) { }
        return o;
    }
    private void ratio(JSONObject o, AccessibilityNodeInfo n) {
        try {
            Rect r = new Rect(); n.getBoundsInScreen(r);
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            o.put("x", Math.round(r.centerX() * 1000.0 / m.widthPixels) / 1000.0); o.put("y", Math.round(r.centerY() * 1000.0 / m.heightPixels) / 1000.0);
        } catch (Exception ignored) { }
    }

    private int score(AccessibilityNodeInfo n, JSONObject sel) {
        if (!n.isVisibleToUser()) return 0;
        int sc = 0;
        String id = sel.optString("id", ""), text = sel.optString("text", ""), desc = sel.optString("desc", "");
        String nid = n.getViewIdResourceName() == null ? "" : n.getViewIdResourceName();
        CharSequence nt = n.getText(), nd = n.getContentDescription();
        String t = nt == null ? "" : nt.toString().trim(), d = nd == null ? "" : nd.toString().trim();
        if (!id.isEmpty()) { if (id.equals(nid)) sc += 4; else if (text.isEmpty() && desc.isEmpty()) return 0; }
        if (!text.isEmpty()) { if (text.equals(t) || text.equals(d)) sc += 5; else if (t.contains(text) || d.contains(text)) sc += 2; else if (id.isEmpty() || !id.equals(nid)) return 0; }
        if (!desc.isEmpty()) { if (desc.equals(d)) sc += 4; else if (d.contains(desc)) sc += 1; }
        return sc;
    }
    private AccessibilityNodeInfo best; private int bestSc;
    private void search(AccessibilityNodeInfo n, JSONObject sel, int depth) {
        if (n == null || depth > 45) return;
        int sc = score(n, sel);
        if (sc > bestSc) { bestSc = sc; best = n; }
        for (int i = 0; i < n.getChildCount(); i++) search(n.getChild(i), sel, depth + 1);
    }
    synchronized AccessibilityNodeInfo find(JSONObject sel) {
        if (sel == null || sel.length() == 0) return null;
        best = null; bestSc = 0;
        try {
            for (android.view.accessibility.AccessibilityWindowInfo w : s.getWindows()) {
                if (w.getType() == android.view.accessibility.AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) continue;
                search(w.getRoot(), sel, 0);
            }
        } catch (Throwable e) { search(s.getRootInActiveWindow(), sel, 0); }
        return best;
    }
    private AccessibilityNodeInfo waitFind(JSONObject sel, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (!stop) {
            AccessibilityNodeInfo n = find(sel);
            if (n != null) return n;
            if (System.currentTimeMillis() > end) return null;
            sleep(350);
        }
        return null;
    }
    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }

    private boolean clickNode(AccessibilityNodeInfo n, boolean lng) {
        int act = lng ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
        for (AccessibilityNodeInfo p = n; p != null; p = p.getParent())
            if ((lng ? p.isLongClickable() : p.isClickable()) && p.performAction(act)) return true;
        Rect r = new Rect(); n.getBoundsInScreen(r);
        return s.tap(r.centerX(), r.centerY(), lng ? 700 : 60);
    }
    private boolean tapRatio(JSONObject st) {
        if (!st.has("x")) return false;
        DisplayMetrics m = s.getResources().getDisplayMetrics();
        return s.tap((int) (st.optDouble("x") * m.widthPixels), (int) (st.optDouble("y") * m.heightPixels), st.optBoolean("long") ? 700 : 60);
    }
    private AccessibilityNodeInfo focusedInput() {
        AccessibilityNodeInfo r = s.getRootInActiveWindow();
        return r == null ? null : r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
    }

    static String label(JSONObject st) {
        String k = st.optString("kind"); JSONObject sel = st.optJSONObject("sel");
        String what = sel == null ? "" : sel.optString("text", sel.optString("desc", ""));
        if (!st.optString("note").isEmpty()) return st.optString("note");
        switch (k) {
            case "launch": return "打开 " + st.optString("app", st.optString("pkg"));
            case "tap": return "点击" + (what.isEmpty() ? "" : "「" + what + "」");
            case "input": return "输入「" + st.optString("text") + "」";
            case "enter": return "回车 / 搜索";
            case "scroll": return st.optBoolean("forward", true) ? "向下滚动" : "向上滚动";
            case "swipe": return "滑动";
            case "key": return "按键 " + st.optString("key");
            case "wait": return "等待「" + what + "」出现";
            case "sleep": return "等 " + st.optInt("ms", 1000) / 1000.0 + " 秒";
            default: return k;
        }
    }

    /* ---------------- 运行 */
    /** 同步执行（在后台线程调用）。返回 {ok, done, total, failedAt, reason, screen, log[]} */
    JSONObject run(String name, JSONArray steps) {
        stop = false;
        JSONObject res = new JSONObject();
        JSONArray log = new JSONArray();
        int n = steps.length(), i = 0;
        try {
            res.put("total", n);
            for (; i < n && !stop; i++) {
                JSONObject st = steps.getJSONObject(i);
                final String lb = label(st);
                showBar(name + " · " + (i + 1) + "/" + n + " " + lb, null, null, "停止", () -> stop = true);
                if (st.optBoolean("confirm")) {
                    waitUser = new CountDownLatch(1); userOk = false;
                    showBar("确认：" + lb + "？", "继续", () -> { userOk = true; waitUser.countDown(); }, "停止", () -> { stop = true; waitUser.countDown(); });
                    waitUser.await(10, TimeUnit.MINUTES);
                    if (!userOk) { stop = true; break; }
                }
                String err = step(st);
                if (err != null && st.optBoolean("optional")) { log.put("跳过：" + lb); continue; }
                if (err != null) {
                    res.put("ok", false); res.put("failedAt", i); res.put("reason", lb + "：" + err);
                    res.put("screen", s.dump(120)); res.put("done", i); res.put("log", log);
                    showBar("Flow 卡在第 " + (i + 1) + " 步：" + err, null, null, "关闭", () -> hideBar(0));
                    hideBar(6000);
                    return res;
                }
                log.put(lb);
                sleep(st.optInt("after", 450));
            }
            res.put("ok", !stop); res.put("done", i); res.put("log", log);
            if (stop) res.put("reason", "用户停止了");
            showBar(stop ? "已停止" : name + " 完成", null, null, null, null);
            hideBar(1800);
        } catch (Exception e) {
            try { res.put("ok", false); res.put("reason", String.valueOf(e.getMessage())); res.put("failedAt", i); } catch (Exception ignored) { }
            hideBar(0);
        }
        return res;
    }

    private String step(JSONObject st) {
        String k = st.optString("kind");
        JSONObject sel = st.optJSONObject("sel");
        long timeout = st.optLong("timeout", 6000);
        switch (k) {
            case "launch": {
                PackageManager pm = s.getPackageManager();
                String pkg = st.optString("pkg");
                Intent i = pkg.isEmpty() ? null : pm.getLaunchIntentForPackage(pkg);
                if (i == null) {
                    String app = st.optString("app");
                    for (ResolveInfo r : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0))
                        if (String.valueOf(r.loadLabel(pm)).contains(app) && !app.isEmpty()) { i = pm.getLaunchIntentForPackage(r.activityInfo.packageName); break; }
                }
                if (i == null) return "没找到这个应用";
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | (st.optBoolean("fresh") ? Intent.FLAG_ACTIVITY_CLEAR_TASK : 0));
                s.startActivity(i); sleep(st.optInt("ms", 1800)); return null;
            }
            case "tap": {
                AccessibilityNodeInfo n = sel == null ? null : waitFind(sel, timeout);
                if (n != null) return clickNode(n, st.optBoolean("long")) ? null : "点击失败";
                if (st.has("x") && (sel == null || st.optBoolean("coordFallback", true))) return tapRatio(st) ? null : "点击失败";
                return "找不到按钮";
            }
            case "input": {
                AccessibilityNodeInfo n = sel != null && sel.length() > 0 ? waitFind(sel, timeout) : null;
                if (n == null) n = focusedInput();
                if (n == null && st.has("x")) { tapRatio(st); sleep(500); n = focusedInput(); }
                if (n == null) return "找不到输入框";
                if (!n.isFocused()) { n.performAction(AccessibilityNodeInfo.ACTION_FOCUS); n.performAction(AccessibilityNodeInfo.ACTION_CLICK); }
                Bundle b = new Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, st.optString("text"));
                return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b) ? null : "输入失败";
            }
            case "enter": {
                AccessibilityNodeInfo n = focusedInput();
                if (n != null && Build.VERSION.SDK_INT >= 30 && n.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId())) return null;
                return "当前输入框不支持回车";
            }
            case "scroll": {
                AccessibilityNodeInfo n = sel != null ? waitFind(sel, 2500) : null;
                int act = st.optBoolean("forward", true) ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
                for (AccessibilityNodeInfo p = n; p != null; p = p.getParent()) if (p.isScrollable() && p.performAction(act)) return null;
                DisplayMetrics m = s.getResources().getDisplayMetrics();
                boolean f = st.optBoolean("forward", true);
                return s.swipe(m.widthPixels / 2, (int) (m.heightPixels * (f ? .72 : .3)), m.widthPixels / 2, (int) (m.heightPixels * (f ? .3 : .72)), 350) ? null : "滚动失败";
            }
            case "swipe": {
                DisplayMetrics m = s.getResources().getDisplayMetrics();
                return s.swipe((int) (st.optDouble("x") * m.widthPixels), (int) (st.optDouble("y") * m.heightPixels), (int) (st.optDouble("x2") * m.widthPixels), (int) (st.optDouble("y2") * m.heightPixels), st.optInt("ms", 350)) ? null : "滑动失败";
            }
            case "key": return s.global(st.optString("key", "back")) ? null : "按键失败";
            case "wait": return waitFind(sel, st.optLong("timeout", 10000)) != null ? null : "等了很久也没出现";
            case "sleep": sleep(st.optInt("ms", 1000)); return null;
            default: return "不认识的步骤 " + k;
        }
    }

    /* ---------------- 录制 */
    void recordStart(String pkg, String app) {
        synchronized (rec) { rec.clear(); }
        pendingInput = null; lastPkg = "";
        recording = true;
        if (pkg != null && !pkg.isEmpty()) {
            try { JSONObject l = new JSONObject(); l.put("kind", "launch"); l.put("pkg", pkg); l.put("app", app); add(l); lastPkg = pkg; } catch (Exception ignored) { }
            Intent i = s.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); s.startActivity(i); }
        }
        updateRecBar();
    }
    private void updateRecBar() {
        int c; synchronized (rec) { c = rec.size(); }
        showBar("● 录制中 · " + c + " 步", "完成", () -> { recording = false; flushInput(); hideBar(0); bringBack(); }, "撤销", () -> { synchronized (rec) { if (rec.size() > 1) rec.remove(rec.size() - 1); } updateRecBar(); });
    }
    private void add(JSONObject o) { synchronized (rec) { rec.add(o); } }
    private void flushInput() { if (pendingInput != null) { add(pendingInput); pendingInput = null; } }

    void onEvent(AccessibilityEvent e) {
        if (!recording) return;
        CharSequence pk = e.getPackageName();
        String pkg = pk == null ? "" : pk.toString();
        if (pkg.equals(s.getPackageName()) || pkg.equals("com.android.systemui")) return;
        AccessibilityNodeInfo n = e.getSource();
        try {
            switch (e.getEventType()) {
                case AccessibilityEvent.TYPE_VIEW_CLICKED:
                case AccessibilityEvent.TYPE_VIEW_LONG_CLICKED: {
                    if (n == null) return;
                    if (n.isEditable()) return; // 点输入框由 input 步骤处理
                    flushInput();
                    JSONObject o = new JSONObject(); o.put("kind", "tap"); o.put("sel", selOf(n)); ratio(o, n);
                    if (e.getEventType() == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) o.put("long", true);
                    add(o); updateRecBar(); break;
                }
                case AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED: {
                    if (n == null) return;
                    CharSequence t = n.getText(); String txt = t == null ? "" : t.toString();
                    if (n.isPassword()) txt = "";
                    if (pendingInput == null) { pendingInput = new JSONObject(); pendingInput.put("kind", "input"); JSONObject sl = selOf(n); sl.remove("text"); pendingInput.put("sel", sl); ratio(pendingInput, n); }
                    pendingInput.put("text", txt);
                    showBar("● 录制中 · 正在输入", "完成", () -> { recording = false; flushInput(); hideBar(0); bringBack(); }, null, null);
                    break;
                }
                case AccessibilityEvent.TYPE_VIEW_SCROLLED: {
                    if (n == null) return;
                    synchronized (rec) { if (!rec.isEmpty() && "scroll".equals(rec.get(rec.size() - 1).optString("kind"))) return; }
                    flushInput();
                    JSONObject o = new JSONObject(); o.put("kind", "scroll"); o.put("forward", e.getScrollDeltaY() >= 0); JSONObject sl = selOf(n); sl.remove("text"); o.put("sel", sl);
                    add(o); updateRecBar(); break;
                }
                case AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED: {
                    if (!pkg.isEmpty() && !pkg.equals(lastPkg) && lastPkg.isEmpty()) {
                        JSONObject o = new JSONObject(); o.put("kind", "launch"); o.put("pkg", pkg); add(o); updateRecBar();
                    }
                    if (!pkg.isEmpty()) lastPkg = pkg;
                    break;
                }
                default:
            }
        } catch (Exception ignored) { }
    }

    JSONArray recorded() { JSONArray a = new JSONArray(); synchronized (rec) { for (JSONObject o : rec) a.put(o); } return a; }
}
