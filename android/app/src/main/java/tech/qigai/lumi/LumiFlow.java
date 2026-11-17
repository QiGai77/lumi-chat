package tech.qigai.lumi;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Flow：录制 / 运行一串手机操作。在无障碍服务里执行，切到别的应用也能稳定跑。
 * 步骤 JSON：{kind: launch|tap|input|enter|scroll|swipe|key|wait|sleep|if|else|endif|while|endwhile|do|dowhile|for|endfor|break|continue|set|call,
 * sel:{id,text,desc,cls}, x,y(0-1 比例), text, pkg, key, forward, ms, optional, confirm, note,
 * cond:{kind:exists|not_exists|text|var, sel, text, var, op, value}, var, value, from, to, step, max, flowId, pointVar}
 * v0.17：解释器移到 FlowVm（纯 Java，可在 JVM 单测），新增 ai 步（缓存选择器原生命中 / 未命中走 AI 视觉）、
 * new/bind/unbind（类与方法）。fast=true 时缩短步间等待与轮询间隔。
 * 快速模式目标口径：原生或缓存选择器的步骤 ≤1 秒/步（launch 与页面加载不计入）；AI 视觉未命中的步要一次模型往返。
 */
public class LumiFlow {
    private final LumiA11yService s;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private View bar; private TextView barText; private TextView btnA, btnB;
    volatile boolean stop = false;
    private volatile CountDownLatch waitUser; private volatile boolean userOk;
    // 快速模式（每次 run() 开始时设置）：缩短步间等待与轮询间隔
    private volatile boolean fast = false;

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
        long poll = fast ? 80 : 350;
        while (!stop) {
            AccessibilityNodeInfo n = find(sel);
            if (n != null) return n;
            if (System.currentTimeMillis() > end) return null;
            sleep(poll);
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

    /* ---------------- 运行（v0.17：解释器在 FlowVm，这里是真机宿主 + AI 视觉） */
    static String label(JSONObject st) { return FlowVm.label(st); }

    /** 刚执行的动作是怎么完成的：native / cache（缓存选择器命中，没调模型）/ vision / coord。 */
    private volatile String src = "native";
    private final List<JSONObject> learned = new ArrayList<>();
    private long visionMs = 0; private int visionCalls = 0;

    JSONObject run(String name, JSONArray steps) { return run(name, steps, false, null); }

    /** 同步执行（在后台线程调用）。返回 FlowVm 的结果，另加 screen（失败时）、learned（视觉找到、可写回的选择器）、visionMs、visionCalls。 */
    JSONObject run(final String name, JSONArray steps, boolean fastMode, JSONObject initVars) {
        stop = false;
        fast = fastMode;
        synchronized (learned) { learned.clear(); }
        visionMs = 0; visionCalls = 0;
        dropPrefetch();
        FlowVm vm = new FlowVm();
        vm.fast = fastMode;
        FlowVm.Host h = new FlowVm.Host() {
            @Override public boolean stopped() { return stop; }
            @Override public void progress(int pc, int total, String lb) {
                showBar(name + " · " + (pc + 1) + "/" + total + " " + lb, null, null, "停止", () -> { stop = true; cancelVision(); });
            }
            @Override public boolean confirm(String lb) {
                waitUser = new CountDownLatch(1); userOk = false;
                showBar("确认：" + lb + "？", "继续", () -> { userOk = true; waitUser.countDown(); }, "停止", () -> { stop = true; waitUser.countDown(); });
                try { waitUser.await(10, TimeUnit.MINUTES); } catch (InterruptedException ignored) { }
                if (!userOk) stop = true;
                return userOk;
            }
            @Override public boolean exists(JSONObject sel, long waitMs) { return waitMs > 0 ? waitFind(sel, waitMs) != null : find(sel) != null; }
            @Override public String screenText() { return s.dump(120); }
            @Override public String act(JSONObject st, int pc) { src = "native"; return step(st); }
            @Override public String lastSrc() { return src; }
            @Override public void settle(long ms) { sleep(ms); }
            @Override public void prefetch(JSONObject next) { maybePrefetch(next); }
        };
        JSONObject res = vm.run(steps, initVars, h);
        try {
            JSONArray l = new JSONArray(); synchronized (learned) { for (JSONObject o : learned) l.put(o); }
            res.put("learned", l); res.put("visionMs", visionMs); res.put("visionCalls", visionCalls);
            if (res.optBoolean("ok")) { showBar(name + " 完成", null, null, null, null); hideBar(1800); }
            else if (stop) { showBar("已停止", null, null, null, null); hideBar(1800); }
            else {
                res.put("screen", s.dump(120));
                showBar("Flow 卡在第 " + (res.optInt("failedAt") + 1) + " 步：" + res.optString("reason"), null, null, "关闭", () -> hideBar(0));
                hideBar(6000);
            }
        } catch (Exception ignored) { }
        dropPrefetch();
        return res;
    }

    /* ---------------- AI 视觉（v0.17）
     * 缓存命中：ai 步带着上次学到的 sel，直接走无障碍原生查找，不调模型（目标 ≤1 秒/步）。
     * 未命中：截屏（长边缩到 720px、JPEG q60）+ 精简元素列表发给 JS，JS 用 Helium（关闭思考、max_tokens 很小、只要 JSON）
     * 定位后回传元素编号或 0-1 坐标；找到的选择器记进 learned，由 JS 写回 Flow，下次走原生。
     * 视觉未命中这一步一定要一次模型往返，耗时取决于网络和模型，不保证 1 秒。 */
    interface VisionSink { void emit(JSONObject req); }
    static volatile VisionSink visionSink;
    private volatile CountDownLatch visionWait;
    private volatile JSONObject visionAns;
    private volatile String visionId = "";
    private final ExecutorService shotExec = Executors.newSingleThreadExecutor();
    private final ExecutorService shotCb = Executors.newSingleThreadExecutor();
    private volatile Future<String> prefetchShot;

    /** 停止时别让视觉步干等。 */
    void cancelVision() { CountDownLatch l = visionWait; if (l != null) l.countDown(); }

    void answerVision(JSONObject a) {
        if (a == null || !visionId.equals(a.optString("id"))) return;
        visionAns = a;
        CountDownLatch l = visionWait; if (l != null) l.countDown();
    }

    /** 截屏 → 长边缩到 720px → JPEG q60 → base64。无障碍截屏要 Android 11（API 30）以上，更早的系统返回 null（只发元素列表）。 */
    private String shot() {
        if (Build.VERSION.SDK_INT < 30) return null;
        final String[] out = { null };
        final CountDownLatch l = new CountDownLatch(1);
        try {
            s.takeScreenshot(Display.DEFAULT_DISPLAY, shotCb, new AccessibilityService.TakeScreenshotCallback() {
                @Override public void onSuccess(AccessibilityService.ScreenshotResult r) {
                    try {
                        HardwareBuffer hb = r.getHardwareBuffer();
                        Bitmap hw = Bitmap.wrapHardwareBuffer(hb, r.getColorSpace());
                        if (hw != null) {
                            Bitmap sw = hw.copy(Bitmap.Config.ARGB_8888, false);
                            int w = sw.getWidth(), ht = sw.getHeight();
                            float k = Math.min(1f, 720f / Math.max(w, ht));
                            Bitmap sc = k < 1f ? Bitmap.createScaledBitmap(sw, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(ht * k)), true) : sw;
                            ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            sc.compress(Bitmap.CompressFormat.JPEG, 60, bo);
                            out[0] = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                            if (sc != sw) sc.recycle();
                            sw.recycle(); hw.recycle();
                        }
                        hb.close();
                    } catch (Throwable ignored) { }
                    l.countDown();
                }
                @Override public void onFailure(int code) { l.countDown(); }
            });
            l.await(1500, TimeUnit.MILLISECONDS);
        } catch (Throwable ignored) { }
        return out[0];
    }

    private static boolean needsVision(JSONObject st) { return st != null && "ai".equals(st.optString("kind")); }

    /** 下一步是 ai 步：和步后等待并行截图（等界面先动 180ms 再截），省掉视觉步开头的截图时间。 */
    private void maybePrefetch(JSONObject next) {
        dropPrefetch();
        if (!needsVision(next)) return;
        final long delay = fast ? 180 : 450;
        try { prefetchShot = shotExec.submit(() -> { sleep(delay); return shot(); }); } catch (Throwable ignored) { }
    }
    private void dropPrefetch() { Future<String> f = prefetchShot; prefetchShot = null; if (f != null) f.cancel(false); }

    /** ai 步：先试缓存的选择器（原生，不调模型）；找不到才走视觉。 */
    private String aiStep(JSONObject st) {
        String act = st.optString("act", "tap");
        JSONObject sel = st.optJSONObject("sel");
        if (sel != null && sel.length() > 0) {
            AccessibilityNodeInfo n = waitFind(sel, fast ? 600 : 1500);
            if (n != null) { dropPrefetch(); src = "cache"; return doAct(n, st, act); }
        }
        return visionAct(st, act, st.optString("goal"));
    }

    private String doAct(AccessibilityNodeInfo n, JSONObject st, String act) {
        if ("input".equals(act)) {
            if (!n.isFocused()) { n.performAction(AccessibilityNodeInfo.ACTION_FOCUS); n.performAction(AccessibilityNodeInfo.ACTION_CLICK); }
            Bundle b = new Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, st.optString("text"));
            if (n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) return null;
            AccessibilityNodeInfo f = focusedInput();
            return f != null && f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b) ? null : "输入失败";
        }
        return clickNode(n, "long".equals(act) || st.optBoolean("long")) ? null : "点击失败";
    }

    private String visionAct(JSONObject st, String act, String goal) {
        VisionSink sink = visionSink;
        if (sink == null) return "AI 视觉不可用（需要在栖语 App 里运行 Flow）";
        if (goal == null || goal.isEmpty()) return "AI 步缺少目标描述";
        long v0 = System.currentTimeMillis();
        String img = null;
        Future<String> f = prefetchShot; prefetchShot = null;
        if (f != null) { try { img = f.get(1500, TimeUnit.MILLISECONDS); } catch (Throwable ignored) { } }
        if (img == null) img = shot();
        String elements = s.dump(60); // 编号与 s.node(i) 对应，回答里的 i 直接拿节点
        DisplayMetrics m = s.getResources().getDisplayMetrics();
        String id = System.nanoTime() + "";
        JSONObject a;
        try {
            JSONObject req = new JSONObject();
            req.put("id", id); req.put("goal", goal); req.put("act", act); req.put("elements", elements);
            req.put("w", m.widthPixels); req.put("h", m.heightPixels);
            if (img != null) req.put("image", img);
            visionAns = null; visionId = id; visionWait = new CountDownLatch(1);
            sink.emit(req);
            boolean got = visionWait.await(st.optLong("visionTimeout", 15000), TimeUnit.MILLISECONDS);
            a = got ? visionAns : null;
        } catch (Exception e) { a = null; }
        visionCalls++; visionMs += System.currentTimeMillis() - v0;
        if (stop) return "用户停止了";
        if (a == null) return "AI 视觉超时";
        if (a.has("error")) return "AI 视觉出错：" + a.optString("error");
        if (a.optBoolean("none")) return "AI 在屏幕上没找到「" + goal + "」";
        if (a.has("i")) {
            AccessibilityNodeInfo n = s.node(a.optInt("i", -1));
            if (n != null) {
                JSONObject sel = selOf(n);
                if ("input".equals(act)) sel.remove("text");
                learn(st, sel, n);
                src = "vision";
                return doAct(n, st, act);
            }
        }
        if (a.has("x") && a.has("y")) {
            double x = a.optDouble("x"), y = a.optDouble("y");
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                learnXY(st, x, y);
                src = "vision";
                boolean ok = s.tap((int) (x * m.widthPixels), (int) (y * m.heightPixels), "long".equals(act) ? 700 : 60);
                if (!ok) return "点击失败";
                if ("input".equals(act)) {
                    sleep(fast ? 150 : 400);
                    AccessibilityNodeInfo n = focusedInput();
                    if (n == null) return "点了 AI 给的位置，但没有出现输入框";
                    Bundle b = new Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, st.optString("text"));
                    return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b) ? null : "输入失败";
                }
                return null;
            }
        }
        return "AI 没给出可用的位置";
    }

    private void learn(JSONObject st, JSONObject sel, AccessibilityNodeInfo n) {
        if (!st.has("_i") || sel.length() == 0) return;
        try {
            JSONObject o = new JSONObject();
            o.put("i", st.optInt("_i")); o.put("fid", st.optString("_fid")); o.put("sel", sel); ratio(o, n);
            synchronized (learned) { learned.add(o); }
        } catch (Exception ignored) { }
    }
    private void learnXY(JSONObject st, double x, double y) {
        if (!st.has("_i")) return;
        try {
            JSONObject o = new JSONObject();
            o.put("i", st.optInt("_i")); o.put("fid", st.optString("_fid")); o.put("x", Math.round(x * 1000) / 1000.0); o.put("y", Math.round(y * 1000) / 1000.0);
            synchronized (learned) { learned.add(o); }
        } catch (Exception ignored) { }
    }

    private String step(JSONObject st) {
        String k = st.optString("kind");
        JSONObject sel = st.optJSONObject("sel");
        long timeout = st.optLong("timeout", fast ? 2500 : 6000);
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
                // 快速模式：不等固定 1800ms，改为每 100ms 检查窗口根节点变化，最多 1200ms
                String before = "";
                try { AccessibilityNodeInfo r0 = s.getRootInActiveWindow(); if (r0 != null && r0.getPackageName() != null) before = r0.getPackageName().toString(); } catch (Throwable ignored) { }
                s.startActivity(i);
                if (fast) {
                    long end = System.currentTimeMillis() + 1200;
                    while (System.currentTimeMillis() < end) {
                        sleep(100);
                        try {
                            AccessibilityNodeInfo r0 = s.getRootInActiveWindow();
                            if (r0 != null && r0.getPackageName() != null && !r0.getPackageName().toString().equals(before)) break;
                        } catch (Throwable ignored) { }
                    }
                } else sleep(st.optInt("ms", 1800));
                return null;
            }
            case "tap": {
                // pointVar 已由 FlowVm 换成 x/y 并标 coordOnly
                if (st.optBoolean("coordOnly")) { src = "coord"; return tapRatio(st) ? null : "点击失败"; }
                boolean vision = st.optBoolean("vision");
                AccessibilityNodeInfo n = sel == null || sel.length() == 0 ? null : waitFind(sel, vision ? Math.min(timeout, fast ? 900 : 2000) : timeout);
                if (n != null) return clickNode(n, st.optBoolean("long")) ? null : "点击失败";
                // v0.17：选择器失效时可以让 AI 视觉找（tap 上设 vision:true），找到后选择器写回 Flow
                if (vision) {
                    String goal = st.optString("goal");
                    if (goal.isEmpty()) goal = FlowVm.selText(sel);
                    return visionAct(st, st.optBoolean("long") ? "long" : "tap", goal);
                }
                if (st.has("x") && (sel == null || st.optBoolean("coordFallback", true))) { src = "coord"; return tapRatio(st) ? null : "点击失败"; }
                return "找不到按钮";
            }
            case "ai": return aiStep(st);
            case "input": {
                AccessibilityNodeInfo n = sel != null && sel.length() > 0 ? waitFind(sel, timeout) : null;
                if (n == null) n = focusedInput();
                if (n == null && st.has("x")) { tapRatio(st); sleep(fast ? 150 : 500); n = focusedInput(); }
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
            case "wait": if (sel == null || sel.length() == 0) return "等待步缺少要等的文字";
                return waitFind(sel, st.optLong("timeout", 10000)) != null ? null : "等了很久也没出现";
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
