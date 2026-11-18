package tech.qigai.lumi;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
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
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Flow：录制 / 运行一串手机操作。在无障碍服务里执行，切到别的应用也能稳定跑。
 * 步骤 JSON：{kind: launch|tap|input|enter|scroll|swipe|key|wait|sleep|if|else|endif|while|endwhile|do|dowhile|for|endfor|break|continue|set|call,
 * sel:{id,text,desc,cls}, x,y(0-1 比例), text, pkg, key, forward, ms, optional, confirm, note,
 * cond:{kind:exists|not_exists|text|var, sel, text, var, op, value}, var, value, from, to, step, max, flowId, pointVar}
 * v0.17：解释器移到 FlowVm（纯 Java，可在 JVM 单测），新增 ai 步（缓存选择器原生命中 / 未命中走 AI 视觉）、
 * new/bind/unbind（类与方法）。fast=true 时缩短步间等待与轮询间隔。
 * 快速模式目标口径：原生或缓存选择器的步骤 ≤1 秒/步（launch 与页面加载不计入）；AI 视觉未命中的步要一次模型往返。
 * v0.23（速度优先）：查找走 findAccessibilityNodeInfosByViewId / ByText 快路径，只在目标应用窗口里找，遍历只作兜底（限深限量）；
 * 步后不再固定 sleep，改为无障碍事件驱动的 look-ahead（下一步的目标一出现就继续）；快速模式里页面指纹一致时直接点缓存坐标；
 * 视觉前先试端侧 OCR（ML Kit 中文）；坐标兜底要求页面指纹一致；每步记录 查找 / 动作 / 等页面 / 视觉 / OCR 的耗时。
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
    volatile boolean resuming = false;
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

    /* ---------------- UI 事件时钟（v0.23）
     * 无障碍事件到达就唤醒运行线程，代替固定 sleep 和 80ms 轮询。
     * wake：所有相关事件（含窗口变化）都会唤醒等待者；react：目标应用自己的状态 / 内容 / 滚动事件，用来判断「点了有没有反应」；
     * quiet：排除「噪音源」（同一窗口同一类控件 1 秒内连发 ≥4 次的内容变化，比如视频进度、轮播图）后最近一次事件的时间。 */
    private final Object evLock = new Object();
    private long wakeSeq = 0, reactSeq = 0, quietAt = 0;
    final Map<String, String> actOf = new ConcurrentHashMap<>();       // 包名 → 最近的 Activity 类名（页面指纹）
    private final Map<String, Boolean> isActivity = new ConcurrentHashMap<>();
    private final Map<String, long[]> noise = new HashMap<>();

    private static long now() { return SystemClock.uptimeMillis(); }

    void onUi(AccessibilityEvent e) {
        CharSequence pk = e.getPackageName();
        String pkg = pk == null ? "" : pk.toString();
        if (pkg.equals(s.getPackageName()) || pkg.equals("com.android.systemui")) return;
        int t = e.getEventType();
        long at = now();
        if (t == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && !pkg.isEmpty()) {
            CharSequence c = e.getClassName();
            if (c != null && activityClass(pkg, c.toString())) actOf.put(pkg, c.toString());
        }
        boolean noisy = false;
        if (t == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            String key = e.getWindowId() + "|" + e.getClassName();
            synchronized (noise) {
                long[] r = noise.get(key);
                if (r == null) { if (noise.size() > 200) noise.clear(); r = new long[4]; noise.put(key, r); }
                System.arraycopy(r, 1, r, 0, 3); r[3] = at;
                noisy = r[0] > 0 && at - r[0] < 1000;
            }
        }
        boolean react = !pkg.isEmpty() && t != AccessibilityEvent.TYPE_WINDOWS_CHANGED;
        synchronized (evLock) {
            wakeSeq++;
            if (react) reactSeq++;
            if (!noisy) quietAt = at;
            evLock.notifyAll();
        }
    }
    private boolean activityClass(String pkg, String cls) {
        String k = pkg + "/" + cls;
        Boolean b = isActivity.get(k);
        if (b == null) {
            try { s.getPackageManager().getActivityInfo(new ComponentName(pkg, cls), 0); b = true; } catch (Throwable ex) { b = false; }
            isActivity.put(k, b);
        }
        return b;
    }
    private long wake() { synchronized (evLock) { return wakeSeq; } }
    private long reacts() { synchronized (evLock) { return reactSeq; } }
    /** 等到有新事件（wakeSeq 超过 seq）或超时。 */
    private void awaitWake(long seq, long ms) {
        if (ms <= 0) return;
        long end = now() + ms;
        synchronized (evLock) {
            while (wakeSeq == seq && !stop) {
                long left = end - now(); if (left <= 0) return;
                try { evLock.wait(left); } catch (InterruptedException ignored) { return; }
            }
        }
    }
    /** 等目标应用有反应（reactSeq 超过 since），返回是否等到。 */
    private boolean awaitReact(long since, long ms) {
        long end = now() + ms;
        synchronized (evLock) {
            while (reactSeq == since && !stop) {
                long left = end - now(); if (left <= 0) return false;
                try { evLock.wait(left); } catch (InterruptedException ignored) { return false; }
            }
            return reactSeq != since;
        }
    }
    /** 等页面安静：quiet 毫秒内没有非噪音事件；最多 max 毫秒。 */
    private void awaitQuiet(long quiet, long max) {
        long end = now() + max;
        synchronized (evLock) {
            while (!stop) {
                long t = now();
                long idle = t - quietAt;
                if (idle >= quiet || t >= end) return;
                try { evLock.wait(Math.max(1, Math.min(quiet - idle, end - t))); } catch (InterruptedException ignored) { return; }
            }
        }
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
    /** 选择器里有能用来找的东西（id / 文字 / 描述）。只有 cls 的选择器打不出分，v0.22 之前会白等满超时再走坐标。 */
    static boolean hasKey(JSONObject sel) {
        return sel != null && (!sel.optString("id").isEmpty() || !sel.optString("text").isEmpty() || !sel.optString("desc").isEmpty());
    }
    static String selKey(JSONObject sel) {
        return sel == null ? "" : sel.optString("id") + "|" + sel.optString("text") + "|" + sel.optString("desc");
    }

    private static int score(AccessibilityNodeInfo n, JSONObject sel) {
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

    /** 当前要操作的应用（launch 步或运行参数给的包名）；空 = 不限。 */
    private volatile String curPkg = "";
    private static String pkgOf(AccessibilityNodeInfo r) { CharSequence p = r == null ? null : r.getPackageName(); return p == null ? "" : p.toString(); }

    /** 要找的窗口：活动窗口是目标应用就用它（最常见，一次 IPC）；否则在屏幕上的应用窗口里找目标包；最后退回活动窗口（系统弹窗、跳到别的应用）。 */
    private List<AccessibilityNodeInfo> roots() {
        List<AccessibilityNodeInfo> out = new ArrayList<>(2);
        AccessibilityNodeInfo act = null;
        try { act = s.getRootInActiveWindow(); } catch (Throwable ignored) { }
        String want = curPkg;
        if (act != null && (want.isEmpty() || want.equals(pkgOf(act)))) { out.add(act); return out; }
        if (!want.isEmpty()) {
            try {
                for (AccessibilityWindowInfo w : s.getWindows()) {
                    if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                    AccessibilityNodeInfo r = w.getRoot();
                    if (r != null && want.equals(pkgOf(r))) { out.add(r); break; }
                }
            } catch (Throwable ignored) { }
        }
        if (act != null) out.add(act);
        return out;
    }
    private String activePkg() { try { return pkgOf(s.getRootInActiveWindow()); } catch (Throwable e) { return ""; } }

    /* 计时（v0.23）：每步拆成 查找 / 动作 / 等页面 / 视觉 / 文字识别，外加命中的是哪一层。 */
    private long tLk, tAc, tWt, tVs, tOc;
    private String tier = "";
    private void hit(String t) { tier = tier.isEmpty() ? t : tier + "+" + t; }

    /** look-ahead 找到的下一步节点：下一步直接用，不再查一次。 */
    private AccessibilityNodeInfo aheadNode; private String aheadKey = ""; private long aheadAt;
    /** look-ahead 预算内没找到的下一步：下一步只查一次就走后备，不再等满超时。 */
    private String aheadMiss = "";

    private Rect want(JSONObject st) {
        if (st == null || !st.has("x") || !st.has("y")) return null;
        DisplayMetrics m = s.getResources().getDisplayMetrics();
        int x = (int) (st.optDouble("x") * m.widthPixels), y = (int) (st.optDouble("y") * m.heightPixels);
        return new Rect(x, y, x, y);
    }
    private static long dist(AccessibilityNodeInfo n, Rect w) {
        if (w == null) return 0;
        Rect r = new Rect(); n.getBoundsInScreen(r);
        long dx = r.centerX() - w.centerX(), dy = r.centerY() - w.centerY();
        return dx * dx + dy * dy;
    }
    @SuppressWarnings("deprecation")
    private static void recycle(AccessibilityNodeInfo n) { try { if (n != null && Build.VERSION.SDK_INT < 33) n.recycle(); } catch (Throwable ignored) { } }

    /** 候选里挑最高分；同分取离录制位置最近的。没选中的回收。 */
    private static AccessibilityNodeInfo pick(List<AccessibilityNodeInfo> c, JSONObject sel, Rect w) {
        if (c == null || c.isEmpty()) return null;
        AccessibilityNodeInfo best = null; int bs = 0; long bd = Long.MAX_VALUE;
        for (AccessibilityNodeInfo n : c) {
            if (n == null) continue;
            int sc = score(n, sel);
            long d = sc > 0 ? dist(n, w) : 0;
            if (sc > bs || (sc == bs && sc > 0 && d < bd)) { bs = sc; bd = d; best = n; }
        }
        for (AccessibilityNodeInfo n : c) if (n != best) recycle(n);
        return best;
    }

    /** 兜底：在一个窗口里限深、限量遍历打分（v0.22 之前每次都遍历所有窗口、45 层、不限量）。 */
    private static final int WALK_DEPTH = 30, WALK_MAX = 1500;
    private AccessibilityNodeInfo wBest; private int wSc, wCount; private long wDist;
    private void walk(AccessibilityNodeInfo n, JSONObject sel, Rect w, int depth, List<AccessibilityNodeInfo> got) {
        if (n == null || depth > WALK_DEPTH || wCount >= WALK_MAX) return;
        wCount++;
        int sc = score(n, sel);
        if (sc > 0) {
            long d = dist(n, w);
            if (sc > wSc || (sc == wSc && d < wDist)) { wSc = sc; wBest = n; wDist = d; }
        }
        int cc = n.getChildCount();
        for (int i = 0; i < cc && wCount < WALK_MAX; i++) {
            AccessibilityNodeInfo ch = n.getChild(i);
            if (ch == null) continue;
            got.add(ch);
            walk(ch, sel, w, depth + 1, got);
        }
    }

    /** 在一个窗口根里找：id 快路径 → 文字快路径（系统侧查找，一次 IPC）→ 限深遍历。 */
    private AccessibilityNodeInfo findIn(AccessibilityNodeInfo root, JSONObject sel, Rect w, String[] how) {
        String id = sel.optString("id"), text = sel.optString("text"), desc = sel.optString("desc");
        try {
            if (!id.isEmpty()) {
                AccessibilityNodeInfo n = pick(root.findAccessibilityNodeInfosByViewId(id), sel, w);
                if (n != null) { how[0] = "id"; return n; }
            }
            if (!text.isEmpty()) {
                AccessibilityNodeInfo n = pick(root.findAccessibilityNodeInfosByText(text), sel, w);
                if (n != null) { how[0] = "text"; return n; }
            }
            if (!desc.isEmpty() && !desc.equals(text)) {
                AccessibilityNodeInfo n = pick(root.findAccessibilityNodeInfosByText(desc), sel, w);
                if (n != null) { how[0] = "text"; return n; }
            }
        } catch (Throwable ignored) { }
        List<AccessibilityNodeInfo> got = new ArrayList<>();
        wBest = null; wSc = 0; wCount = 0; wDist = Long.MAX_VALUE;
        try { walk(root, sel, w, 0, got); } catch (Throwable ignored) { }
        AccessibilityNodeInfo b = wBest; wBest = null;
        for (AccessibilityNodeInfo n : got) if (n != b) recycle(n);
        if (b != null) how[0] = "walk";
        return b;
    }

    /** 查一次（不等待）。 */
    synchronized AccessibilityNodeInfo find(JSONObject sel) { return find(sel, null, null); }
    private synchronized AccessibilityNodeInfo find(JSONObject sel, JSONObject st, String[] how) {
        if (!hasKey(sel)) return null;
        String[] h = how == null ? new String[1] : how;
        Rect w = want(st);
        for (AccessibilityNodeInfo r : roots()) {
            AccessibilityNodeInfo n = findIn(r, sel, w, h);
            if (n != null) return n;
        }
        return null;
    }

    /** 事件驱动地找：先马上查一次，没找到就等下一个无障碍事件再查（没有事件时最多隔 250ms 兜底再查一次）。 */
    private AccessibilityNodeInfo waitFind(JSONObject sel, long ms) { return waitFind(sel, null, ms, null); }
    private AccessibilityNodeInfo waitFind(JSONObject sel, JSONObject st, long ms, String[] how) {
        if (!hasKey(sel)) return null;
        long end = now() + ms;
        while (!stop) {
            long seq = wake();
            AccessibilityNodeInfo n = find(sel, st, how);
            if (n != null) return n;
            long left = end - now();
            if (left <= 0) return null;
            awaitWake(seq, Math.min(left, fast ? 250 : 400));
        }
        return null;
    }

    /** 动作步的定位：look-ahead 刚找到的直接用；look-ahead 没找到的只查一次；否则事件驱动地等到超时。计入「查找」耗时。 */
    private AccessibilityNodeInfo locate(JSONObject sel, JSONObject st, long ms) {
        long t0 = now();
        try {
            String k = selKey(sel);
            AccessibilityNodeInfo a = aheadNode;
            if (a != null && k.equals(aheadKey) && now() - aheadAt < 1500) { aheadNode = null; aheadKey = ""; hit("ahead"); return a; }
            String[] how = new String[1];
            long budget = k.equals(aheadMiss) ? 0 : ms;
            aheadMiss = "";
            AccessibilityNodeInfo n = waitFind(sel, st, budget, how);
            if (n != null) hit(how[0] == null ? "walk" : how[0]);
            return n;
        } finally { tLk += now() - t0; }
    }

    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }

    private static final long TAP_MS = 10; // 手势点击的按下时长：够大多数控件识别为点击，比 v0.22 的 60ms 快

    /** 点节点：可点的自己或 4 层内的祖先用 performAction(CLICK)（不经过触摸管线，最快）；都不行或重试时在节点中心手势点。 */
    private boolean clickNode(AccessibilityNodeInfo n, boolean lng, boolean gesture) {
        long t0 = now();
        try {
            if (!gesture) {
                int act = lng ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
                AccessibilityNodeInfo p = n;
                for (int d = 0; p != null && d < 5; d++) {
                    if ((lng ? p.isLongClickable() : p.isClickable()) && p.performAction(act)) return true;
                    p = p.getParent();
                }
            } else n.refresh();
            Rect r = new Rect(); n.getBoundsInScreen(r);
            if (r.width() <= 0 || r.height() <= 0) return false;
            return s.tap(r.centerX(), r.centerY(), lng ? 700 : TAP_MS);
        } finally { tAc += now() - t0; }
    }
    private boolean tapXY(double x, double y, boolean lng) {
        long t0 = now();
        try {
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            return s.tap((int) (x * m.widthPixels), (int) (y * m.heightPixels), lng ? 700 : TAP_MS);
        } finally { tAc += now() - t0; }
    }
    private boolean tapRatio(JSONObject st) { return st.has("x") && tapXY(st.optDouble("x"), st.optDouble("y"), st.optBoolean("long")); }
    private AccessibilityNodeInfo focusedInput() {
        for (AccessibilityNodeInfo r : roots()) {
            try { AccessibilityNodeInfo f = r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT); if (f != null && f.isEditable()) return f; } catch (Throwable ignored) { }
        }
        return null;
    }
    /** 只有 cls 的输入框选择器：屏幕上可见的可编辑控件里离录制位置最近的那个（限深遍历）。 */
    private AccessibilityNodeInfo firstEditable(JSONObject st) {
        Rect w = want(st);
        for (AccessibilityNodeInfo r : roots()) {
            List<AccessibilityNodeInfo> got = new ArrayList<>();
            editWalk(r, 0, new int[1], got);
            AccessibilityNodeInfo best = null; long bd = Long.MAX_VALUE;
            for (AccessibilityNodeInfo n : got) { long d = dist(n, w); if (d < bd) { bd = d; best = n; } }
            if (best != null) return best;
        }
        return null;
    }
    private void editWalk(AccessibilityNodeInfo n, int depth, int[] cnt, List<AccessibilityNodeInfo> got) {
        if (n == null || depth > WALK_DEPTH || ++cnt[0] > WALK_MAX || got.size() >= 8) return;
        if (n.isEditable() && n.isVisibleToUser()) { got.add(n); return; }
        for (int i = 0; i < n.getChildCount(); i++) editWalk(n.getChild(i), depth + 1, cnt, got);
    }

    /* ---------------- 页面指纹（v0.23）：目标包 + 最近的 Activity + 屏幕尺寸。坐标兜底和缓存坐标都要求指纹一致。 */
    JSONObject fpNow(String pkg) {
        JSONObject o = new JSONObject();
        try {
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            o.put("pkg", pkg); String a = actOf.get(pkg); if (a != null) o.put("act", a);
            o.put("w", m.widthPixels); o.put("h", m.heightPixels);
        } catch (Exception ignored) { }
        return o;
    }
    /** 当前屏幕是否和记录的指纹一致；strictAct：记录里有 Activity 时必须相同。 */
    private boolean fpMatch(JSONObject fp) {
        if (fp == null) return false;
        String pkg = activePkg();
        if (pkg.isEmpty() || !pkg.equals(fp.optString("pkg"))) return false;
        DisplayMetrics m = s.getResources().getDisplayMetrics();
        if (fp.optInt("w") != m.widthPixels || fp.optInt("h") != m.heightPixels) return false;
        String a = fp.optString("act");
        return a.isEmpty() || a.equals(actOf.get(pkg));
    }
    /** 坐标兜底是否允许：录制时有指纹就要指纹一致；旧 Flow（没有指纹）退一步：当前前台是目标应用。 */
    private boolean coordAllowed(JSONObject st) {
        JSONObject fp = st.optJSONObject("fp");
        if (fp != null) return fpMatch(fp);
        String pkg = activePkg();
        return !pkg.isEmpty() && (curPkg.isEmpty() || pkg.equals(curPkg));
    }

    /* ---------------- 运行（v0.17：解释器在 FlowVm，这里是真机宿主 + 分层定位） */
    static String label(JSONObject st) { return FlowVm.label(st); }

    /** 刚执行的动作是怎么完成的：native / cache（缓存选择器或缓存坐标，没调模型）/ ocr / vision / coord。 */
    private volatile String src = "native";
    private final List<JSONObject> learned = new ArrayList<>();
    /** 这一步学到、还没验证的东西；after() 确认下一步出现（或页面有反应）后才并入 learned。 */
    private final List<JSONObject> pending = new ArrayList<>();
    private long visionMs = 0; private int visionCalls = 0, ocrCalls = 0;
    private long actAt = 0, reactAtAct = 0;

    JSONObject run(String name, JSONArray steps) { return run(name, steps, false, null, ""); }

    /** 同步执行（在后台线程调用）。返回 FlowVm 的结果，另加 screen / shot（失败时）、learned（验证过、可写回的选择器与缓存坐标）、visionMs、visionCalls、ocrCalls。 */
    JSONObject run(final String name, JSONArray steps, boolean fastMode, JSONObject initVars, String pkg) {
        running = true;
        try { return runInner(name, steps, fastMode, initVars, pkg); } finally { running = false; }
    }
    private JSONObject runInner(final String name, JSONArray steps, boolean fastMode, JSONObject initVars, String pkg) {
        stop = false;
        fast = fastMode;
        curPkg = pkg == null ? "" : pkg;
        synchronized (learned) { learned.clear(); }
        pending.clear();
        visionMs = 0; visionCalls = 0; ocrCalls = 0;
        aheadNode = null; aheadKey = ""; aheadMiss = "";
        if (needsOcr(steps)) warmOcr();
        FlowVm vm = new FlowVm();
        vm.fast = fastMode;
        FlowVm.Host h = new FlowVm.Host() {
            @Override public boolean stopped() { return stop; }
            @Override public void progress(int pc, int total, String lb) {
                showBar(name + " · " + (pc + 1) + "/" + total + " " + lb, null, null, "停止", () -> { stop = true; cancelVision(); cancelAgent(); });
            }
            @Override public boolean confirm(String lb) {
                waitUser = new CountDownLatch(1); userOk = false;
                showBar("确认：" + lb + "？", "继续", () -> { userOk = true; waitUser.countDown(); }, "停止", () -> { stop = true; waitUser.countDown(); });
                try { waitUser.await(10, TimeUnit.MINUTES); } catch (InterruptedException ignored) { }
                if (!userOk) stop = true;
                return userOk;
            }
            @Override public boolean exists(JSONObject sel, long waitMs) { return waitMs > 0 ? waitFind(sel, waitMs) != null : find(sel) != null; }
            @Override public String screenText() { return s.dump(120, primaryRoot()); }
            @Override public String act(JSONObject st, int pc) {
                if (!st.optBoolean("_retry")) { tLk = tAc = tWt = tVs = tOc = 0; tier = ""; }
                else hit("retry");
                pending.clear();
                src = "native";
                actAt = now(); reactAtAct = reacts();
                return step(st);
            }
            @Override public String lastSrc() { return src; }
            @Override public void settle(long ms) { sleep(ms); }
            @Override public String after(JSONObject done, JSONObject next) {
                long t0 = now();
                String r;
                try { r = afterStep(done, next); } catch (Throwable e) { r = "settled"; }
                tWt += now() - t0;
                if (!"noreact".equals(r)) commitLearned(); else pending.clear();
                return r;
            }
            @Override public JSONObject timing() {
                JSONObject o = new JSONObject();
                try { o.put("lk", tLk); o.put("ac", tAc); o.put("wt", tWt); o.put("vs", tVs); o.put("oc", tOc); if (!tier.isEmpty()) o.put("tier", tier); } catch (Exception ignored) { }
                return o;
            }
        };
        JSONObject res = vm.run(steps, initVars, h);
        try {
            JSONArray l = new JSONArray(); synchronized (learned) { for (JSONObject o : learned) l.put(o); }
            res.put("learned", l); res.put("visionMs", visionMs); res.put("visionCalls", visionCalls); res.put("ocrCalls", ocrCalls);
            res.put("engine", "v0.23");
            if (res.optBoolean("ok")) { showBar(name + " 完成", null, null, null, null); hideBar(1800); }
            else if (stop) { showBar("已停止", null, null, null, null); hideBar(1800); }
            else {
                hideBar(0);
                awaitQuiet(fast ? 120 : 300, 1000);
                res.put("screen", s.dump(120, primaryRoot()));
                String shot = shotJpeg(480, 50);
                if (shot != null) res.put("shot", shot);
                showBar("Flow 卡在第 " + (res.optInt("failedAt") + 1) + " 步：" + res.optString("reason"), null, null, "关闭", () -> hideBar(0));
                hideBar(6000);
            }
        } catch (Exception ignored) { }
        return res;
    }
    private AccessibilityNodeInfo primaryRoot() { List<AccessibilityNodeInfo> r = roots(); return r.isEmpty() ? null : r.get(0); }

    private void commitLearned() {
        if (pending.isEmpty()) return;
        synchronized (learned) { learned.addAll(pending); }
        pending.clear();
    }

    /** look-ahead 能找的下一步：带 id / 文字 / 描述选择器的动作步。 */
    private static boolean lookable(JSONObject next) {
        if (next == null) return false;
        String k = next.optString("kind");
        if (FlowVm.isControl(k) || next.optBoolean("coordOnly")) return false;
        switch (k) {
            case "tap": case "input": case "ai": case "wait": case "scroll": return hasKey(next.optJSONObject("sel"));
            default: return false;
        }
    }
    private boolean pkgOnScreen() {
        if (curPkg.isEmpty()) return true;
        if (curPkg.equals(activePkg())) return true;
        try {
            for (AccessibilityWindowInfo w : s.getWindows()) {
                if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null && curPkg.equals(pkgOf(r))) return true;
            }
        } catch (Throwable ignored) { }
        return false;
    }

    /**
     * 步后等待（v0.23）：
     * - 下一步有可找的目标：等第一个反应事件（最多 150ms，防止在旧页面上命中同 id 的节点），然后每来一个事件就找一次下一步的目标，找到立刻返回 ok；
     *   预算（快速 3s / 普通 6s；launch 冷启动 6s / 12s）用完：有过反应 → miss，完全没反应 → noreact（FlowVm 会手势重做一次）。
     * - 下一步没有可找的目标：等反应（最多 400ms）+ 安静窗（快速 120ms，最多 2s）。
     * - 最后一步：只等一个反应事件（最多 300ms），用来确认学到的东西可以写回。
     */
    private String afterStep(JSONObject done, JSONObject next) {
        String k = done.optString("kind");
        if (k.equals("sleep") || k.equals("wait")) return "ok";
        boolean launch = k.equals("launch");
        long since = reactAtAct;
        if (next == null) {
            if (launch) { long end = now() + (fast ? 6000 : 12000); while (!stop && !pkgOnScreen() && now() < end) awaitWake(wake(), 200); return "ok"; }
            awaitReact(since, fast ? 300 : 600);
            return "ok";
        }
        if (k.equals("input") && "enter".equals(next.optString("kind"))) return "ok";
        if (lookable(next)) {
            JSONObject nsel = next.optJSONObject("sel");
            String key = selKey(nsel);
            long budget = next.has("timeout") ? Math.min(next.optLong("timeout"), 15000) : launch ? (fast ? 6000 : 12000) : (fast ? 3000 : 6000);
            long end = now() + budget;
            if (!launch) awaitReact(since, 150);
            while (!stop) {
                long seq = wake();
                if (!launch || pkgOnScreen()) {
                    AccessibilityNodeInfo n = find(nsel, next, null);
                    if (n != null) { aheadNode = n; aheadKey = key; aheadAt = now(); aheadMiss = ""; return "ok"; }
                }
                long left = end - now();
                if (left <= 0) break;
                awaitWake(seq, Math.min(left, fast ? 250 : 400));
            }
            aheadMiss = key;
            return reacts() != since ? "miss" : "noreact";
        }
        if (launch) {
            long end = now() + (fast ? 6000 : 12000);
            while (!stop && !pkgOnScreen() && now() < end) awaitWake(wake(), 200);
            awaitQuiet(fast ? 250 : 400, Math.max(0, Math.min(end - now(), fast ? 3000 : 5000)));
            return "settled";
        }
        awaitReact(since, fast ? 400 : 800);
        awaitQuiet(fast ? 120 : 300, fast ? 2000 : 4000);
        return "settled";
    }

    /* ---------------- 缓存坐标（v0.23 快速模式）
     * 验证通过的点击记下 hit = {pkg, act, w, h, x, y, sig}；下次快速模式里页面指纹一致、选择器没改，就直接点这个坐标，不查找，
     * 再由 look-ahead 验证；没反应时 FlowVm 重做这一步（走正常查找 + 手势点）。在可滚动容器里的控件不记（位置会变）。 */
    private boolean hitUsable(JSONObject st) {
        JSONObject hit = st.optJSONObject("hit");
        if (hit == null || !fast || st.optBoolean("_retry") || st.optBoolean("long")) return false;
        if (!hit.optString("sig").equals(selKey(st.optJSONObject("sel")))) return false;
        if (!hit.has("x") || !hit.has("y")) return false;
        return fpMatch(hit);
    }
    private void learnHit(JSONObject st, AccessibilityNodeInfo n) {
        if (!st.has("_i") || st.optBoolean("long")) return;
        JSONObject sel = st.optJSONObject("sel");
        if (!hasKey(sel)) return;
        try {
            Rect r = new Rect(); n.getBoundsInScreen(r);
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            double x = Math.round(r.centerX() * 10000.0 / m.widthPixels) / 10000.0, y = Math.round(r.centerY() * 10000.0 / m.heightPixels) / 10000.0;
            JSONObject old = st.optJSONObject("hit");
            String pkg = pkgOf(n);
            if (old != null && old.optString("sig").equals(selKey(sel)) && Math.abs(old.optDouble("x") - x) < 0.01 && Math.abs(old.optDouble("y") - y) < 0.01
                && pkg.equals(old.optString("pkg")) && String.valueOf(actOf.get(pkg)).equals(old.optString("act", "null"))) return; // 没变，不用写
            AccessibilityNodeInfo p = n.getParent();
            for (int d = 0; p != null && d < 6; d++) { if (p.isScrollable()) return; p = p.getParent(); }
            JSONObject h = fpNow(pkg);
            h.put("x", x); h.put("y", y); h.put("sig", selKey(sel));
            JSONObject o = new JSONObject();
            o.put("i", st.optInt("_i")); o.put("fid", st.optString("_fid")); o.put("hit", h);
            pending.add(o);
        } catch (Exception ignored) { }
    }

    /* ---------------- 截图（v0.23：只在页面安静后拍；一张图给 OCR 和视觉共用） */
    interface VisionSink { void emit(JSONObject req); }
    static volatile VisionSink visionSink;
    private volatile CountDownLatch visionWait;
    private volatile JSONObject visionAns;
    private volatile String visionId = "";
    private final ExecutorService shotCb = Executors.newSingleThreadExecutor();
    private final ExecutorService bg = Executors.newSingleThreadExecutor();

    /** 停止时别让视觉步干等。 */
    void cancelVision() { CountDownLatch l = visionWait; if (l != null) l.countDown(); }

    void answerVision(JSONObject a) {
        if (a == null || !visionId.equals(a.optString("id"))) return;
        visionAns = a;
        CountDownLatch l = visionWait; if (l != null) l.countDown();
    }

    /** 整屏截图（软件位图，屏幕像素坐标）。无障碍截屏要 Android 11（API 30）以上；系统限制两次截图之间约 1/3 秒。 */
    private Bitmap shotBitmap() {
        if (Build.VERSION.SDK_INT < 30) return null;
        final Bitmap[] out = { null };
        final CountDownLatch l = new CountDownLatch(1);
        try {
            s.takeScreenshot(Display.DEFAULT_DISPLAY, shotCb, new AccessibilityService.TakeScreenshotCallback() {
                @Override public void onSuccess(AccessibilityService.ScreenshotResult r) {
                    try {
                        HardwareBuffer hb = r.getHardwareBuffer();
                        Bitmap hw = Bitmap.wrapHardwareBuffer(hb, r.getColorSpace());
                        if (hw != null) { out[0] = hw.copy(Bitmap.Config.ARGB_8888, false); hw.recycle(); }
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
    private static String jpeg(Bitmap sw, int maxEdge, int q) {
        if (sw == null) return null;
        try {
            int w = sw.getWidth(), ht = sw.getHeight();
            float k = Math.min(1f, (float) maxEdge / Math.max(w, ht));
            Bitmap sc = k < 1f ? Bitmap.createScaledBitmap(sw, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(ht * k)), true) : sw;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            sc.compress(Bitmap.CompressFormat.JPEG, q, bo);
            if (sc != sw) sc.recycle();
            return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable e) { return null; }
    }
    private String shotJpeg(int maxEdge, int q) {
        Bitmap b = shotBitmap();
        String r = jpeg(b, maxEdge, q);
        if (b != null) b.recycle();
        return r;
    }

    /* ---------------- 端侧 OCR（v0.23，ML Kit 中文，打包在 APK 里，不需要 Google Play 服务） */
    private static boolean needsOcr(JSONArray steps) {
        for (int i = 0; i < steps.length(); i++) {
            JSONObject o = steps.optJSONObject(i);
            if (o != null && ("ai".equals(o.optString("kind")) || o.optBoolean("vision") || ("tap".equals(o.optString("kind")) && o.optJSONObject("sel") != null && !o.optJSONObject("sel").optString("text").isEmpty()))) return true;
        }
        return false;
    }
    /** 第一次识别要加载模型（几百毫秒），运行开始时在后台先热身。 */
    private void warmOcr() { if (Build.VERSION.SDK_INT >= 30) bg.execute(LumiOcr::warm); }

    /** 能拿来 OCR 匹配的字面文字：选择器文字 / 描述；ai 步的目标里用「」或引号括起来的字；很短的目标本身。 */
    static String ocrText(JSONObject st) {
        JSONObject sel = st.optJSONObject("sel");
        if (sel != null) {
            String t = sel.optString("text"); if (!t.isEmpty() && t.length() <= 20) return t;
            String d = sel.optString("desc"); if (!d.isEmpty() && d.length() <= 20) return d;
        }
        String g = st.optString("goal").trim();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("[「“\"']([^」”\"']{1,20})[」”\"']").matcher(g);
        if (m.find()) return m.group(1);
        if (!g.isEmpty() && g.length() <= 6 && !g.contains(" ")) return g;
        return "";
    }

    /** 截图上找文字并点击（或点后输入）。返回 null 成功；"" 表示这一层没找到（继续下一层）；其它字符串是失败原因。 */
    private String ocrAct(JSONObject st, String act, String text, Bitmap shot) {
        if (text.isEmpty() || shot == null) return "";
        long t0 = now();
        Rect r;
        try { r = LumiOcr.find(shot, text, 2500); } catch (Throwable e) { r = null; }
        finally { tOc += now() - t0; ocrCalls++; }
        if (r == null) return "";
        hit("ocr");
        src = "ocr";
        boolean lng = "long".equals(act) || st.optBoolean("long");
        long a0 = now();
        boolean ok = s.tap(r.centerX(), r.centerY(), lng ? 700 : TAP_MS);
        tAc += now() - a0;
        if (!ok) return "点击失败";
        if ("input".equals(act)) return inputFocused(st);
        DisplayMetrics m = s.getResources().getDisplayMetrics();
        learnXY(st, r.centerX() / (double) m.widthPixels, r.centerY() / (double) m.heightPixels);
        return null;
    }
    /** 点了输入框之后：等焦点落到可编辑控件上（事件驱动，最多 1s），再写文字。 */
    private String inputFocused(JSONObject st) {
        long end = now() + (fast ? 800 : 1500);
        AccessibilityNodeInfo n = null;
        while (!stop) { long seq = wake(); n = focusedInput(); if (n != null || now() >= end) break; awaitWake(seq, Math.min(150, end - now())); }
        if (n == null) return "点了位置，但没有出现输入框";
        return setText(n, st.optString("text")) ? null : "输入失败";
    }
    private boolean setText(AccessibilityNodeInfo n, String text) {
        long t0 = now();
        try {
            if (!n.isFocused()) { n.performAction(AccessibilityNodeInfo.ACTION_FOCUS); n.performAction(AccessibilityNodeInfo.ACTION_CLICK); }
            Bundle b = new Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            if (n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) return true;
            AccessibilityNodeInfo f = focusedInput();
            return f != null && f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
        } finally { tAc += now() - t0; }
    }

    /* ---------------- AI 视觉：只在原生查找、look-ahead、OCR 都没成时才用
     * 截屏（长边 720px、JPEG q60）+ 目标窗口的精简元素列表（最多 150 个）发给 JS，JS 用 Helium 定位后回传元素编号或 0-1 坐标。
     * 学到的选择器先放 pending，下一步验证通过才写回 Flow。 */
    private String doAct(AccessibilityNodeInfo n, JSONObject st, String act) {
        if ("input".equals(act)) return setText(n, st.optString("text")) ? null : "输入失败";
        return clickNode(n, "long".equals(act) || st.optBoolean("long"), st.optBoolean("_retry")) ? null : "点击失败";
    }

    /** ai 步：缓存选择器（原生）→ OCR → 视觉。 */
    private String aiStep(JSONObject st) {
        String act = st.optString("act", "tap");
        JSONObject sel = st.optJSONObject("sel");
        if (hasKey(sel)) {
            AccessibilityNodeInfo n = locate(sel, st, fast ? 600 : 1500);
            if (n != null) { src = "cache"; String e = doAct(n, st, act); if (e == null && !"input".equals(act)) learnHit(st, n); return e; }
        }
        return slowTiers(st, act, st.optString("goal"));
    }

    /** OCR → 视觉，两层共用一张页面安静后拍的截图。 */
    private String slowTiers(JSONObject st, String act, String goal) {
        long q0 = now();
        awaitQuiet(fast ? 120 : 300, fast ? 1500 : 3000);
        tWt += now() - q0;
        Bitmap shot = shotBitmap();
        try {
            String t = ocrText(st);
            if (!t.isEmpty() && shot != null) {
                String r = ocrAct(st, act, t, shot);
                if (r == null || !r.isEmpty()) return r;
            }
            return visionAct(st, act, goal, shot);
        } finally { if (shot != null) shot.recycle(); }
    }

    private String visionAct(JSONObject st, String act, String goal, Bitmap shot) {
        VisionSink sink = visionSink;
        if (sink == null) return "AI 视觉不可用（需要在栖语 App 里运行 Flow）";
        if (goal == null || goal.isEmpty()) return "AI 步缺少目标描述";
        long v0 = now();
        String img = jpeg(shot, 720, 60);
        String elements = s.dump(150, primaryRoot()); // 编号与 s.node(i) 对应，回答里的 i 直接拿节点
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
        long took = now() - v0;
        visionCalls++; visionMs += took; tVs += took;
        hit("vision");
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
                if (!tapXY(x, y, "long".equals(act))) return "点击失败";
                if ("input".equals(act)) return inputFocused(st);
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
            pending.add(o);
        } catch (Exception ignored) { }
    }
    private void learnXY(JSONObject st, double x, double y) {
        if (!st.has("_i")) return;
        try {
            JSONObject o = new JSONObject();
            o.put("i", st.optInt("_i")); o.put("fid", st.optString("_fid")); o.put("x", Math.round(x * 1000) / 1000.0); o.put("y", Math.round(y * 1000) / 1000.0);
            pending.add(o);
        } catch (Exception ignored) { }
    }

    private String step(JSONObject st) {
        String k = st.optString("kind");
        JSONObject sel = st.optJSONObject("sel");
        long timeout = st.optLong("timeout", fast ? 2500 : 6000);
        boolean retry = st.optBoolean("_retry");
        switch (k) {
            case "launch": {
                PackageManager pm = s.getPackageManager();
                String pkg = st.optString("pkg");
                Intent i = pkg.isEmpty() ? null : pm.getLaunchIntentForPackage(pkg);
                if (i == null) {
                    String app = st.optString("app");
                    for (ResolveInfo r : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0))
                        if (String.valueOf(r.loadLabel(pm)).contains(app) && !app.isEmpty()) { i = pm.getLaunchIntentForPackage(r.activityInfo.packageName); pkg = r.activityInfo.packageName; break; }
                }
                if (i == null) return "没找到这个应用";
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | (st.optBoolean("fresh") ? Intent.FLAG_ACTIVITY_CLEAR_TASK : 0));
                if (!pkg.isEmpty()) curPkg = pkg;
                long t0 = now();
                s.startActivity(i);
                tAc += now() - t0;
                hit("launch");
                // v0.23：不在这里等（v0.22 普通模式固定睡 1.8 秒）。步后等待会等到目标应用的窗口出现并且下一步的目标能找到
                // （冷启动最多 6 秒），找到立刻继续。步上显式写了 ms 的旧 Flow 仍按 ms 等。
                if (st.has("ms")) sleep(st.optInt("ms"));
                return null;
            }
            case "tap": {
                // pointVar 已由 FlowVm 换成 x/y 并标 coordOnly
                if (st.optBoolean("coordOnly")) { src = "coord"; hit("coord"); return tapRatio(st) ? null : "点击失败"; }
                // 上一步等页面时已经找到了这一步的节点就直接用（准确且不耗时）；否则快速模式里页面指纹一致时点缓存坐标
                boolean pre = aheadNode != null && selKey(sel).equals(aheadKey);
                if (!pre && hitUsable(st)) {
                    JSONObject h = st.optJSONObject("hit");
                    src = "cache"; hit("bounds");
                    return tapXY(h.optDouble("x"), h.optDouble("y"), false) ? null : "点击失败";
                }
                boolean vision = st.optBoolean("vision");
                AccessibilityNodeInfo n = hasKey(sel) ? locate(sel, st, vision ? Math.min(timeout, fast ? 900 : 2000) : timeout) : null;
                if (n != null) {
                    if (!clickNode(n, st.optBoolean("long"), retry)) return "点击失败";
                    learnHit(st, n);
                    return null;
                }
                // v0.17：选择器失效时可以让 AI 视觉找（tap 上设 vision:true）；v0.23 先试端侧 OCR
                if (vision) {
                    String goal = st.optString("goal");
                    if (goal.isEmpty()) goal = FlowVm.selText(sel);
                    return slowTiers(st, st.optBoolean("long") ? "long" : "tap", goal);
                }
                // v0.23：坐标兜底只在页面指纹和录制时一致时才点（旧 Flow 没有指纹：要求前台是目标应用）
                if (st.has("x") && st.optBoolean("coordFallback", true) && coordAllowed(st)) { src = "coord"; hit("coord"); return tapRatio(st) ? null : "点击失败"; }
                // 选择器有文字时最后试一次 OCR（WebView / 自绘控件常常树里没字、图上有字）
                if (!ocrText(st).isEmpty() && Build.VERSION.SDK_INT >= 30) {
                    long q0 = now(); awaitQuiet(fast ? 120 : 300, 1500); tWt += now() - q0;
                    Bitmap b = shotBitmap();
                    try { String r = ocrAct(st, "tap", ocrText(st), b); if (r == null || !r.isEmpty()) return r; }
                    finally { if (b != null) b.recycle(); }
                }
                return st.has("x") && !coordAllowed(st) ? "找不到按钮（当前页面和录制时不一样，没有按坐标点）" : "找不到按钮";
            }
            case "ai": return aiStep(st);
            case "agent": return agentStep(st);
            case "input": {
                AccessibilityNodeInfo n = hasKey(sel) ? locate(sel, st, timeout) : null;
                if (n == null) { long t0 = now(); n = focusedInput(); if (n != null) hit("focus"); tLk += now() - t0; }
                if (n == null) { long t0 = now(); n = firstEditable(st); if (n != null) hit("edit"); tLk += now() - t0; }
                if (n == null && st.has("x") && coordAllowed(st)) { hit("coord"); src = "coord"; tapRatio(st); return inputFocused(st); }
                if (n == null) return "找不到输入框";
                return setText(n, st.optString("text")) ? null : "输入失败";
            }
            case "enter": {
                AccessibilityNodeInfo n = focusedInput();
                long t0 = now();
                try { if (n != null && Build.VERSION.SDK_INT >= 30 && n.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId())) return null; }
                finally { tAc += now() - t0; }
                return "当前输入框不支持回车";
            }
            case "scroll": {
                AccessibilityNodeInfo n = hasKey(sel) ? locate(sel, st, fast ? 1200 : 2500) : null;
                int act = st.optBoolean("forward", true) ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
                long t0 = now();
                try {
                    AccessibilityNodeInfo p = n;
                    for (int d = 0; p != null && d < 8; d++) { if (p.isScrollable() && p.performAction(act)) return null; p = p.getParent(); }
                    DisplayMetrics m = s.getResources().getDisplayMetrics();
                    boolean f = st.optBoolean("forward", true);
                    return s.swipe(m.widthPixels / 2, (int) (m.heightPixels * (f ? .72 : .3)), m.widthPixels / 2, (int) (m.heightPixels * (f ? .3 : .72)), 300) ? null : "滚动失败";
                } finally { tAc += now() - t0; }
            }
            case "swipe": {
                DisplayMetrics m = s.getResources().getDisplayMetrics();
                long t0 = now();
                try { return s.swipe((int) (st.optDouble("x") * m.widthPixels), (int) (st.optDouble("y") * m.heightPixels), (int) (st.optDouble("x2") * m.widthPixels), (int) (st.optDouble("y2") * m.heightPixels), st.optInt("ms", 300)) ? null : "滑动失败"; }
                finally { tAc += now() - t0; }
            }
            case "key": { long t0 = now(); try { return s.global(st.optString("key", "back")) ? null : "按键失败"; } finally { tAc += now() - t0; } }
            case "wait": if (!hasKey(sel)) return "等待步缺少要等的文字";
                return locate(sel, st, st.optLong("timeout", 10000)) != null ? null : "等了很久也没出现";
            case "sleep": sleep(st.optInt("ms", 1000)); return null;
            default: return "不认识的步骤 " + k;
        }
    }

    /* ---------------- v0.24 AI 接管（agent 步）
     * 原生运行到 agent 步时把步骤交给 JS（flowAgent 事件），JS 的 agent 循环用 agentObserve / agentAct 一轮一轮地看屏幕、调模型、执行，
     * 结束后用 flowAgentAnswer 回传 {ok, reason}；ok 时 Flow 接着跑后面的步骤。这里只等结果，不做判断。 */
    interface AgentSink { void emit(JSONObject req); }
    static volatile AgentSink agentSink;
    private volatile CountDownLatch agentWait;
    private volatile JSONObject agentAns;
    private volatile String agentId = "";
    /** Flow 正在运行（agent 步在等 JS）。单独运行的 AI 接管（从对比卡继续）不会改 Flow 的停止标记。 */
    volatile boolean running = false;

    void cancelAgent() { CountDownLatch l = agentWait; if (l != null) l.countDown(); }
    void answerAgent(JSONObject a) {
        if (a == null || !agentId.equals(a.optString("id"))) return;
        agentAns = a;
        CountDownLatch l = agentWait; if (l != null) l.countDown();
    }

    private String agentStep(JSONObject st) {
        AgentSink sink = agentSink;
        if (sink == null) return "AI 接管不可用（需要在栖语 App 里运行 Flow）";
        if (st.optString("goal").trim().isEmpty()) return "AI 接管缺少目标";
        src = "agent"; hit("agent");
        long t0 = now();
        String id = "ag" + System.nanoTime();
        JSONObject a;
        try {
            JSONObject req = new JSONObject();
            req.put("id", id); req.put("step", st);
            agentAns = null; agentId = id; agentWait = new CountDownLatch(1);
            sink.emit(req);
            long budget = (long) (Math.max(0.5, Math.min(30, st.optDouble("maxMinutes", 5))) * 60000) + 90000;
            boolean got = agentWait.await(budget, TimeUnit.MILLISECONDS);
            a = got ? agentAns : null;
        } catch (Exception e) { a = null; }
        tAc += now() - t0;
        if (stop) return "用户停止了";
        if (a == null) return "AI 接管超时";
        if (a.optBoolean("ok")) return null;
        String r = a.optString("reason");
        return r.isEmpty() ? "AI 接管没有完成" : r;
    }

    /** 单独运行 AI 接管前清掉上次的停止标记（Flow 正在跑时不动它）。 */
    void agentBegin() { if (!running) stop = false; }

    /** 一轮观察：等页面安静 → 活动窗口的元素列表（编号和 agentAct 的 id 对应）+ 截图。 */
    JSONObject agentObserve(int max, boolean shot, long quiet, long maxWait) {
        JSONObject o = new JSONObject();
        try {
            long q0 = now();
            awaitQuiet(quiet, maxWait);
            o.put("waitMs", now() - q0);
            o.put("elements", s.dump(Math.max(20, Math.min(200, max)), null));
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            o.put("w", m.widthPixels); o.put("h", m.heightPixels);
            String pkg = activePkg();
            o.put("pkg", pkg);
            String act = actOf.get(pkg); if (act != null) o.put("act", act);
            if (shot) { String img = shotJpeg(720, 60); if (img != null) o.put("image", img); }
            o.put("stopped", stop);
        } catch (Exception ignored) { }
        return o;
    }

    /** 点击目标真正会触发的那块：自己或最近的可点祖先；文字取它自己 + 子树（限深）+ 描述，用来做付款 / 发送 / 删除拦截。 */
    private static String guardText(AccessibilityNodeInfo n) {
        if (n == null) return "";
        AccessibilityNodeInfo t = n;
        for (int d = 0; t != null && d < 5 && !t.isClickable(); d++) t = t.getParent();
        if (t == null) t = n;
        StringBuilder sb = new StringBuilder();
        collect(n, 0, sb);
        if (t != n) collect(t, 0, sb);
        return sb.length() > 400 ? sb.substring(0, 400) : sb.toString();
    }
    private static void collect(AccessibilityNodeInfo n, int depth, StringBuilder sb) {
        if (n == null || depth > 3 || sb.length() > 400) return;
        CharSequence t = n.getText(), d = n.getContentDescription();
        if (t != null && t.length() > 0) sb.append(t).append(' ');
        if (d != null && d.length() > 0) sb.append(d).append(' ');
        for (int i = 0; i < n.getChildCount() && i < 12; i++) collect(n.getChild(i), depth + 1, sb);
    }
    /** 屏幕坐标处最深的可见节点（活动窗口里限量遍历）。 */
    private AccessibilityNodeInfo nodeAt(int x, int y) {
        AccessibilityNodeInfo root;
        try { root = s.getRootInActiveWindow(); } catch (Throwable e) { return null; }
        AccessibilityNodeInfo best = null;
        java.util.ArrayDeque<AccessibilityNodeInfo> q = new java.util.ArrayDeque<>();
        if (root != null) q.add(root);
        int seen = 0;
        Rect r = new Rect();
        while (!q.isEmpty() && seen++ < WALK_MAX) {
            AccessibilityNodeInfo n = q.poll();
            if (n == null || !n.isVisibleToUser()) continue;
            n.getBoundsInScreen(r);
            if (!r.contains(x, y)) continue;
            best = n;
            for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo c = n.getChild(i); if (c != null) q.add(c); }
        }
        return best;
    }

    /** 执行 agent 的一个动作。guard 是拦截正则：点击目标的文字命中就不点，返回 blocked + 目标文字。 */
    JSONObject agentAct(JSONObject a) {
        JSONObject o = new JSONObject();
        try {
            String op = a.optString("op");
            String guard = a.optString("guard");
            java.util.regex.Pattern g = guard.isEmpty() ? null : java.util.regex.Pattern.compile(guard);
            DisplayMetrics m = s.getResources().getDisplayMetrics();
            boolean ok;
            switch (op) {
                case "tap": case "long": {
                    boolean lng = "long".equals(op);
                    int id = a.optInt("id", -1);
                    AccessibilityNodeInfo n; int px = 0, py = 0;
                    if (id >= 0) n = s.node(id);
                    else { px = (int) (a.optDouble("x") * m.widthPixels); py = (int) (a.optDouble("y") * m.heightPixels); n = nodeAt(px, py); }
                    if (id >= 0 && n == null) { o.put("ok", false); o.put("err", "没有这个元素编号"); return o; }
                    String t = guardText(n);
                    o.put("text", t);
                    if (g != null && g.matcher(t).find()) { o.put("ok", false); o.put("blocked", true); return o; }
                    ok = id >= 0 ? s.click(id, lng) : s.tap(px, py, lng ? 700 : 60);
                    break;
                }
                case "input": {
                    int id = a.optInt("id", -1);
                    ok = s.input(id, a.optString("text"));
                    if (!ok) { AccessibilityNodeInfo f = focusedInput(); ok = f != null && setText(f, a.optString("text")); }
                    break;
                }
                case "enter": {
                    AccessibilityNodeInfo f = focusedInput();
                    ok = f != null && Build.VERSION.SDK_INT >= 30 && f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
                    break;
                }
                case "scroll": {
                    boolean down = !"up".equals(a.optString("dir"));
                    ok = s.swipe(m.widthPixels / 2, (int) (m.heightPixels * (down ? .72 : .3)), m.widthPixels / 2, (int) (m.heightPixels * (down ? .3 : .72)), 380);
                    break;
                }
                case "swipe": {
                    String d = a.optString("dir", "left");
                    int cx = m.widthPixels / 2, cy = m.heightPixels / 2, dx = (int) (m.widthPixels * .32), dy = (int) (m.heightPixels * .25);
                    int x1 = cx, y1 = cy, x2 = cx, y2 = cy;
                    if ("left".equals(d)) { x1 = cx + dx; x2 = cx - dx; } else if ("right".equals(d)) { x1 = cx - dx; x2 = cx + dx; }
                    else if ("up".equals(d)) { y1 = cy + dy; y2 = cy - dy; } else { y1 = cy - dy; y2 = cy + dy; }
                    ok = s.swipe(x1, y1, x2, y2, 320);
                    break;
                }
                case "back": ok = s.global("back"); break;
                case "wait": sleep(Math.max(200, Math.min(3000, a.optInt("ms", 1200)))); ok = true; break;
                default: o.put("ok", false); o.put("err", "不认识的动作 " + op); return o;
            }
            o.put("ok", ok);
            if (!ok) o.put("err", "动作没有成功");
        } catch (Exception e) { try { o.put("ok", false); o.put("err", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
        return o;
    }

    /** 悬浮条：AI 接管每一轮的想法，带「停止」。 */
    void agentBar(String text) { showBar(text, null, null, "停止", () -> { stop = true; cancelVision(); cancelAgent(); }); }
    /** AI 接管结束：back=true 时回到栖语；offer=true 时悬浮条给一个「查看对比」按钮。 */
    void agentEnd(String text, boolean back, boolean offer) {
        if (back) { hideBar(0); bringBack(); return; }
        if (text == null || text.isEmpty()) { hideBar(0); return; }
        if (offer) { showBar(text, "查看对比", () -> { hideBar(0); bringBack(); }, "关闭", () -> hideBar(0)); hideBar(15000); }
        else { showBar(text, null, null, null, null); hideBar(2500); }
    }

    /* ---------------- 录制 */
    void recordStart(String pkg, String app) { recordStart(pkg, app, false); }
    /** resume = 继续录制（v0.22）：不记「打开应用」这一步，把应用切回前台（已在后台时回到原来的页面），新步骤由 JS 接到已有 Flow 后面。 */
    void recordStart(String pkg, String app, boolean resume) {
        synchronized (rec) { rec.clear(); }
        pendingInput = null; lastPkg = "";
        resuming = resume;
        recording = true;
        if (pkg != null && !pkg.isEmpty()) {
            if (resume) lastPkg = pkg;
            else try { JSONObject l = new JSONObject(); l.put("kind", "launch"); l.put("pkg", pkg); l.put("app", app); add(l); lastPkg = pkg; } catch (Exception ignored) { }
            Intent i = s.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); s.startActivity(i); }
        }
        updateRecBar();
    }
    private void updateRecBar() {
        int c; synchronized (rec) { c = rec.size(); }
        showBar((resuming ? "● 继续录制 · 新增 " : "● 录制中 · ") + c + " 步", "完成", () -> { recording = false; flushInput(); hideBar(0); bringBack(); }, "撤销", () -> { synchronized (rec) { if (rec.size() > (resuming ? 0 : 1)) rec.remove(rec.size() - 1); } updateRecBar(); });
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
                    JSONObject o = new JSONObject(); o.put("kind", "tap"); o.put("sel", selOf(n)); ratio(o, n); o.put("fp", fpNow(pkg));
                    if (e.getEventType() == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) o.put("long", true);
                    add(o); updateRecBar(); break;
                }
                case AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED: {
                    if (n == null) return;
                    CharSequence t = n.getText(); String txt = t == null ? "" : t.toString();
                    if (n.isPassword()) txt = "";
                    if (pendingInput == null) { pendingInput = new JSONObject(); pendingInput.put("kind", "input"); JSONObject sl = selOf(n); sl.remove("text"); pendingInput.put("sel", sl); ratio(pendingInput, n); pendingInput.put("fp", fpNow(pkg)); }
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
