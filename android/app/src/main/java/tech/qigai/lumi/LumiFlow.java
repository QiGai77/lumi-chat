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

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Flow：录制 / 运行一串手机操作。在无障碍服务里执行，切到别的应用也能稳定跑。
 * 步骤 JSON：{kind: launch|tap|input|enter|scroll|swipe|key|wait|sleep|if|else|endif|while|endwhile|do|dowhile|for|endfor|break|continue|set|call,
 * sel:{id,text,desc,cls}, x,y(0-1 比例), text, pkg, key, forward, ms, optional, confirm, note,
 * cond:{kind:exists|not_exists|text|var, sel, text, var, op, value}, var, value, from, to, step, max, flowId, pointVar}
 * v0.16：run() 是 pc 循环解释器（控制栈 + 变量表 + 循环保护）；fast=true 时缩短步间等待与轮询间隔。
 * 快速模式目标口径：缓存选择器的步骤 ≤1 秒/步（launch 与页面加载不计入）。
 */
public class LumiFlow {
    private final LumiA11yService s;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private View bar; private TextView barText; private TextView btnA, btnB;
    volatile boolean stop = false;
    private volatile CountDownLatch waitUser; private volatile boolean userOk;
    // v0.16 解释器状态（每次 run() 开始时重置）
    private boolean fast = false;
    private final Map<String, Object> vars = new HashMap<>();
    private JSONArray stepMs;

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

    static String condLabel(JSONObject c) {
        if (c == null) return "";
        switch (c.optString("kind")) {
            case "exists": return "出现「" + selText(c.optJSONObject("sel")) + "」";
            case "not_exists": return "没有「" + selText(c.optJSONObject("sel")) + "」";
            case "text": return "屏幕包含「" + c.optString("text") + "」";
            case "var": return c.optString("var") + " " + c.optString("op", "==") + " " + c.optString("value");
            default: return "";
        }
    }
    private static String selText(JSONObject sel) {
        if (sel == null) return "";
        String t = sel.optString("text", sel.optString("desc", ""));
        return t.isEmpty() ? sel.optString("id", "") : t;
    }

    static String label(JSONObject st) {
        String k = st.optString("kind"); JSONObject sel = st.optJSONObject("sel");
        String what = sel == null ? "" : sel.optString("text", sel.optString("desc", ""));
        if (!st.optString("note").isEmpty()) return st.optString("note");
        switch (k) {
            case "launch": return "打开 " + st.optString("app", st.optString("pkg"));
            case "tap": return "点击" + (st.has("pointVar") ? "变量点 " + st.optString("pointVar") : what.isEmpty() ? "" : "「" + what + "」");
            case "input": return "输入「" + st.optString("text") + "」";
            case "enter": return "回车 / 搜索";
            case "scroll": return st.optBoolean("forward", true) ? "向下滚动" : "向上滚动";
            case "swipe": return "滑动";
            case "key": return "按键 " + st.optString("key");
            case "wait": return "等待「" + what + "」出现";
            case "sleep": return "等 " + st.optInt("ms", 1000) / 1000.0 + " 秒";
            case "if": return "如果 " + condLabel(st.optJSONObject("cond"));
            case "else": return "否则";
            case "endif": return "条件结束";
            case "while": return "循环：当 " + condLabel(st.optJSONObject("cond"));
            case "endwhile": return "循环结束";
            case "do": return "先执行一次";
            case "dowhile": return "重复执行，直到不满足 " + condLabel(st.optJSONObject("cond"));
            case "for": return "循环 " + st.optString("var") + " 从 " + st.optDouble("from") + " 到 " + st.optDouble("to");
            case "endfor": return "循环结束";
            case "break": return "跳出循环";
            case "continue": return "继续下一轮";
            case "set": return "设置 " + st.optString("var") + " = " + st.optString("value");
            case "call": return "调用子流程 " + st.optString("flowId");
            default: return k;
        }
    }

    /* ---------------- 运行（v0.16 解释器） */
    /** 控制栈帧：IF{elseSeen, taken}、WHILE{startPc, cond, iter, max}、FOR{var, cur, end, step, startPc}、DO{startPc}。 */
    private static class Frame {
        String type; int startPc; boolean elseSeen; boolean taken;
        JSONObject cond; int iter; int max = 20;
        String var; double cur, end, step;
    }

    /** 同步执行（在后台线程调用）。返回 {ok, done, total, failedAt, reason, screen, log[], ms, stepMs[]} */
    JSONObject run(String name, JSONArray steps) { return run(name, steps, false); }

    JSONObject run(String name, JSONArray steps, boolean fastMode) {
        stop = false;
        fast = fastMode;
        vars.clear();
        stepMs = new JSONArray();
        JSONObject res = new JSONObject();
        JSONArray log = new JSONArray();
        int n = steps.length();
        long t0 = System.currentTimeMillis();
        int executed = 0;
        Deque<Frame> stack = new ArrayDeque<>();
        try {
            res.put("total", n);
            int pc = 0;
            while (pc < n && !stop) {
                if (++executed > MAX_EXEC_STEPS) return fail(res, log, pc, executed, "执行步数超过 " + MAX_EXEC_STEPS + " 步，可能死循环", name, t0);
                JSONObject st = steps.getJSONObject(pc);
                String kind = st.optString("kind");
                final String lb = label(st);
                showBar(name + " · " + (pc + 1) + "/" + n + " " + lb, null, null, "停止", () -> stop = true);
                long st0 = System.currentTimeMillis();
                // ---- 控制流步：不发给 step()，直接改 pc ----
                if (isControl(kind)) {
                    int next = control(st, steps, pc, stack, lb);
                    if (next < 0) return fail(res, log, pc, executed, controlError, name, t0);
                    stepMs.put(System.currentTimeMillis() - st0);
                    if (!isSilentControl(kind)) log.put(lb + " · " + (System.currentTimeMillis() - st0) + "ms");
                    pc = next;
                    continue;
                }
                if (st.optBoolean("confirm")) {
                    waitUser = new CountDownLatch(1); userOk = false;
                    showBar("确认：" + lb + "？", "继续", () -> { userOk = true; waitUser.countDown(); }, "停止", () -> { stop = true; waitUser.countDown(); });
                    waitUser.await(10, TimeUnit.MINUTES);
                    if (!userOk) { stop = true; break; }
                }
                String err = step(st);
                long took = System.currentTimeMillis() - st0;
                stepMs.put(took);
                if (err != null && st.optBoolean("optional")) { log.put("跳过：" + lb + " · " + took + "ms"); pc++; continue; }
                if (err != null) return fail(res, log, pc, executed, lb + "：" + err, name, t0);
                log.put(lb + " · " + took + "ms");
                sleep(st.optInt("after", fast ? 120 : 450));
                pc++;
            }
            res.put("ok", !stop); res.put("done", executed); res.put("log", log);
            res.put("ms", System.currentTimeMillis() - t0); res.put("stepMs", stepMs);
            if (stop) res.put("reason", "用户停止了");
            showBar(stop ? "已停止" : name + " 完成", null, null, null, null);
            hideBar(1800);
        } catch (Exception e) {
            try { res.put("ok", false); res.put("reason", String.valueOf(e.getMessage())); res.put("failedAt", 0); res.put("ms", System.currentTimeMillis() - t0); res.put("stepMs", stepMs); } catch (Exception ignored) { }
            hideBar(0);
        }
        return res;
    }

    private static final int MAX_EXEC_STEPS = 500;
    private String controlError = "";

    private JSONObject fail(JSONObject res, JSONArray log, int pc, int executed, String reason, String name, long t0) {
        try {
            res.put("ok", false); res.put("failedAt", pc); res.put("reason", reason);
            res.put("screen", s.dump(120)); res.put("done", executed); res.put("log", log);
            res.put("ms", System.currentTimeMillis() - t0); res.put("stepMs", stepMs);
        } catch (Exception ignored) { }
        showBar("Flow 卡在第 " + (pc + 1) + " 步：" + reason, null, null, "关闭", () -> hideBar(0));
        hideBar(6000);
        return res;
    }

    private static boolean isControl(String kind) {
        switch (kind) {
            case "if": case "else": case "endif": case "while": case "endwhile":
            case "do": case "dowhile": case "for": case "endfor":
            case "break": case "continue": case "set": case "call":
                return true;
            default: return false;
        }
    }
    /** 块结束步不记 log（太吵），其余控制步记一条。 */
    private static boolean isSilentControl(String kind) {
        return kind.equals("endif") || kind.equals("endwhile") || kind.equals("endfor");
    }

    /** 找与 pc 处开块匹配的结束步；else 也算 if 的匹配目标（返回其位置，调用方区分）。 */
    private int findMatch(JSONArray steps, int pc, String open, String close, String alt) {
        int depth = 0;
        for (int i = pc; i < steps.length(); i++) {
            String k;
            try { k = steps.getJSONObject(i).optString("kind"); } catch (Exception e) { continue; }
            if (k.equals(open)) depth++;
            else if (alt != null && k.equals(alt) && depth == 1) return i;
            else if (k.equals(close)) { depth--; if (depth == 0) return i; }
        }
        return -1;
    }
    private int loopEndPc(JSONArray steps, Frame f) {
        switch (f.type) {
            case "WHILE": return findMatch(steps, f.startPc, "while", "endwhile", null);
            case "FOR": return findMatch(steps, f.startPc, "for", "endfor", null);
            default: return findMatch(steps, f.startPc, "do", "dowhile", null); // DO
        }
    }

    /**
     * 执行一步控制流，返回下一个 pc；出错返回 -1（原因写 controlError）。
     * 循环保护：单循环迭代 > max（默认 20，步上用 max 覆盖）即失败；嵌套超过 8 层失败。
     */
    private int control(JSONObject st, JSONArray steps, int pc, Deque<Frame> stack, String lb) {
        String kind = st.optString("kind");
        controlError = "";
        switch (kind) {
            case "if": {
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) { controlError = lb + "：缺少 cond 条件"; return -1; }
                if (evalCond(cond)) {
                    Frame f = new Frame(); f.type = "IF"; f.startPc = pc; f.taken = true; stack.push(f);
                    return pc + 1;
                }
                int els = findMatch(steps, pc, "if", "endif", "else");
                if (els < 0) { controlError = lb + "：没有对应的 endif"; return -1; }
                String k;
                try { k = steps.getJSONObject(els).optString("kind"); } catch (Exception e) { k = ""; }
                if (k.equals("else")) {
                    Frame f = new Frame(); f.type = "IF"; f.startPc = pc; f.taken = false; f.elseSeen = true; stack.push(f);
                    return els + 1;
                }
                return els + 1;
            }
            case "else": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("IF")) { controlError = lb + "：没有对应的 if"; return -1; }
                if (f.taken) {
                    int end = findMatch(steps, f.startPc, "if", "endif", null);
                    stack.pop();
                    return end < 0 ? steps.length() : end + 1;
                }
                return pc + 1;
            }
            case "endif": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("IF")) { controlError = lb + "：没有对应的 if"; return -1; }
                stack.pop();
                return pc + 1;
            }
            case "while": {
                Frame top = stack.peek();
                if (top != null && top.type.equals("WHILE") && top.startPc == pc) {
                    // 从 endwhile 跳回：复用已有帧，只重判条件
                    if (!evalCond(top.cond)) { stack.pop(); int end = findMatch(steps, pc, "while", "endwhile", null); return end < 0 ? steps.length() : end + 1; }
                    return pc + 1;
                }
                if (stack.size() >= 8) { controlError = lb + "：循环嵌套超过 8 层"; return -1; }
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) { controlError = lb + "：缺少 cond 条件"; return -1; }
                if (!evalCond(cond)) { int end = findMatch(steps, pc, "while", "endwhile", null); return end < 0 ? steps.length() : end + 1; }
                Frame f = new Frame(); f.type = "WHILE"; f.startPc = pc; f.cond = cond; f.max = st.optInt("max", 20); stack.push(f);
                return pc + 1;
            }
            case "endwhile": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("WHILE")) { controlError = lb + "：没有对应的 while"; return -1; }
                if (++f.iter > f.max) { controlError = "循环超过 " + f.max + " 次"; return -1; }
                return f.startPc; // 回到 while 步重判条件
            }
            case "do": {
                if (stack.size() >= 8) { controlError = lb + "：循环嵌套超过 8 层"; return -1; }
                Frame f = new Frame(); f.type = "DO"; f.startPc = pc; f.max = st.optInt("max", 20); stack.push(f);
                return pc + 1;
            }
            case "dowhile": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("DO")) { controlError = lb + "：没有对应的 do"; return -1; }
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) { controlError = lb + "：缺少 cond 条件"; return -1; }
                if (evalCond(cond)) {
                    if (++f.iter > f.max) { controlError = "循环超过 " + f.max + " 次"; return -1; }
                    return f.startPc + 1; // 回到 do 体开头（至少执行过一次）
                }
                stack.pop();
                return pc + 1;
            }
            case "for": {
                Frame top = stack.peek();
                if (top != null && top.type.equals("FOR") && top.startPc == pc) {
                    // 从 endfor/continue 跳回：只判边界，不再初始化
                    if (pastEnd(top)) { stack.pop(); int end = findMatch(steps, pc, "for", "endfor", null); return end < 0 ? steps.length() : end + 1; }
                    vars.put(top.var, top.cur);
                    return pc + 1;
                }
                if (stack.size() >= 8) { controlError = lb + "：循环嵌套超过 8 层"; return -1; }
                if (!st.has("var") || !st.has("from") || !st.has("to")) { controlError = lb + "：for 缺少 var/from/to"; return -1; }
                double step = st.has("step") ? st.optDouble("step") : (st.optDouble("to") >= st.optDouble("from") ? 1 : -1);
                if (step == 0) { controlError = lb + "：for 的 step 不能为 0"; return -1; }
                Frame f = new Frame(); f.type = "FOR"; f.startPc = pc; f.var = st.optString("var");
                f.cur = st.optDouble("from"); f.end = st.optDouble("to"); f.step = step; f.max = st.optInt("max", 20);
                if (pastEnd(f)) { int end = findMatch(steps, pc, "for", "endfor", null); return end < 0 ? steps.length() : end + 1; }
                vars.put(f.var, f.cur);
                stack.push(f);
                return pc + 1;
            }
            case "endfor": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("FOR")) { controlError = lb + "：没有对应的 for"; return -1; }
                if (++f.iter > f.max) { controlError = "循环超过 " + f.max + " 次"; return -1; }
                f.cur += f.step;
                return f.startPc; // 回到 for 步判边界
            }
            case "break": {
                Frame loop = nearestLoop(stack);
                if (loop == null) { controlError = lb + "：不在任何循环里"; return -1; }
                // 弹出直到该循环帧（含）为止的所有帧
                while (!stack.isEmpty()) { Frame f = stack.pop(); if (f == loop) break; }
                int end = loopEndPc(steps, loop);
                return end < 0 ? steps.length() : end + 1;
            }
            case "continue": {
                Frame loop = nearestLoop(stack);
                if (loop == null) { controlError = lb + "：不在任何循环里"; return -1; }
                // 先弹出循环体里未闭合的 if 帧（比如 continue 写在 if 块内），再跳回循环头
                while (!stack.isEmpty() && stack.peek() != loop) stack.pop();
                switch (loop.type) {
                    case "WHILE": if (++loop.iter > loop.max) { controlError = "循环超过 " + loop.max + " 次"; return -1; } return loop.startPc;
                    case "FOR": if (++loop.iter > loop.max) { controlError = "循环超过 " + loop.max + " 次"; return -1; } loop.cur += loop.step; return loop.startPc;
                    default: { // DO：跳到尾部 dowhile 判条件
                        int end = loopEndPc(steps, loop);
                        return end < 0 ? steps.length() : end;
                    }
                }
            }
            case "set": {
                if (!st.has("var")) { controlError = lb + "：set 缺少 var"; return -1; }
                try { vars.put(st.optString("var"), evalValue(st.optString("value", ""))); }
                catch (Exception e) { controlError = lb + "：变量求值失败"; return -1; }
                return pc + 1;
            }
            case "call": {
                // TS 侧 runFlow 已用 expandCalls 内联；走到这里说明调用过深或循环调用
                controlError = lb + "：子流程未展开（调用层数过深或循环调用）";
                return -1;
            }
            default: controlError = "不认识的步骤 " + kind; return -1;
        }
    }

    private static Frame nearestLoop(Deque<Frame> stack) {
        for (Frame f : stack) if (f.type.equals("WHILE") || f.type.equals("FOR") || f.type.equals("DO")) return f;
        return null;
    }
    private static boolean pastEnd(Frame f) {
        return f.step > 0 ? f.cur > f.end : f.cur < f.end;
    }

    /* ---------------- 条件与变量求值 */
    private boolean evalCond(JSONObject c) {
        if (c == null) return false;
        switch (c.optString("kind")) {
            case "exists": return find(c.optJSONObject("sel")) != null; // 只查一次，不等待
            case "not_exists": return find(c.optJSONObject("sel")) == null;
            case "text": return s.dump(120).contains(c.optString("text", ""));
            case "var": {
                Object v = vars.get(c.optString("var"));
                if (v == null) return false;
                String rhs = c.optString("value", "");
                String op = c.optString("op", "==");
                if (op.equals("contains")) return varString(v).contains(rhs);
                Double vn = toNum(v), rn = toNum(rhs);
                if (vn != null && rn != null) {
                    switch (op) {
                        case "==": return vn.equals(rn);
                        case "!=": return !vn.equals(rn);
                        case ">": return vn > rn;
                        case "<": return vn < rn;
                        case ">=": return vn >= rn;
                        case "<=": return vn <= rn;
                    }
                    return false;
                }
                String vs = varString(v);
                switch (op) {
                    case "==": return vs.equals(rhs);
                    case "!=": return !vs.equals(rhs);
                    case ">": return vs.compareTo(rhs) > 0;
                    case "<": return vs.compareTo(rhs) < 0;
                    case ">=": return vs.compareTo(rhs) >= 0;
                    case "<=": return vs.compareTo(rhs) <= 0;
                    default: return false;
                }
            }
            default: return false;
        }
    }
    private static String varString(Object v) {
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v;
            if (o.has("x") && o.has("y") && o.length() == 2) return o.optDouble("x") + "," + o.optDouble("y");
            return o.toString();
        }
        if (v instanceof Double) { double d = (Double) v; return d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d); }
        return String.valueOf(v);
    }
    private static Double toNum(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof String) { try { return Double.parseDouble((String) v); } catch (NumberFormatException e) { return null; } }
        return null;
    }

    /** set 步 value 求值：${变量} 插值 → struct JSON → point "0.5,0.3" → 数字/四则/字符串拼接 → 原字符串。 */
    private Object evalValue(String raw) {
        String t = interp(raw).trim();
        if (t.isEmpty()) return "";
        if (t.startsWith("{")) { try { return new JSONObject(t); } catch (Exception ignored) { } }
        if (t.startsWith("[")) { try { return new JSONArray(t); } catch (Exception ignored) { } }
        java.util.regex.Matcher pt = java.util.regex.Pattern.compile("^(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$").matcher(t);
        if (pt.matches()) { try { JSONObject o = new JSONObject(); o.put("x", Double.parseDouble(pt.group(1))); o.put("y", Double.parseDouble(pt.group(2))); return o; } catch (Exception ignored) { } }
        try { return Double.parseDouble(t); } catch (NumberFormatException ignored) { }
        if (t.contains("+")) {
            String[] parts = t.split("\\+", -1);
            StringBuilder sb = new StringBuilder();
            boolean allKnown = true, anyString = false;
            for (String p : parts) {
                String q = p.trim();
                if (q.length() >= 2 && ((q.startsWith("\"") && q.endsWith("\"")) || (q.startsWith("'") && q.endsWith("'")))) { sb.append(q.substring(1, q.length() - 1)); anyString = true; }
                else if (vars.containsKey(q)) { sb.append(varString(vars.get(q))); if (!(vars.get(q) instanceof Number)) anyString = true; }
                else if (q.matches("-?\\d+(\\.\\d+)?")) sb.append(q);
                else { allKnown = false; break; }
            }
            if (allKnown && anyString) return sb.toString();
        }
        if (t.matches("[\\d\\s+\\-*/%().A-Za-z_]+")) {
            String replaced = t;
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*").matcher(t);
            boolean ok = true;
            while (m.find()) {
                String name = m.group();
                Object v = vars.get(name);
                if (v == null || !(v instanceof Number)) { ok = false; break; }
                replaced = replaced.replaceAll("\\b" + java.util.regex.Pattern.quote(name) + "\\b", varString(v));
            }
            if (ok) { Double d = evalArith(replaced); if (d != null) return d; }
        }
        return t;
    }
    private String interp(String raw) {
        StringBuilder sb = new StringBuilder();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}").matcher(raw);
        int last = 0;
        while (m.find()) {
            sb.append(raw, last, m.start());
            Object v = vars.get(m.group(1));
            sb.append(v == null ? "" : varString(v));
            last = m.end();
        }
        sb.append(raw.substring(last));
        return sb.toString();
    }
    /** 小型四则求值（+ - * / % 与括号），非法返回 null。 */
    private static Double evalArith(String expr) {
        try { return new Arith(expr).parse(); } catch (Exception e) { return null; }
    }
    private static class Arith {
        private final String s; private int i;
        Arith(String s) { this.s = s; }
        Double parse() { Double v = add(); skip(); if (i != s.length()) throw new IllegalArgumentException(); return v; }
        private void skip() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        private Double num() {
            skip();
            if (i < s.length() && s.charAt(i) == '(') { i++; Double v = add(); skip(); if (i >= s.length() || s.charAt(i) != ')') throw new IllegalArgumentException(); i++; return v; }
            int st = i;
            if (i < s.length() && s.charAt(i) == '-') i++;
            while (i < s.length() && (Character.isDigit(s.charAt(i)) || s.charAt(i) == '.')) i++;
            if (i == st) throw new IllegalArgumentException();
            return Double.parseDouble(s.substring(st, i));
        }
        private Double mul() {
            Double v = num();
            for (;;) { skip(); if (i >= s.length()) return v; char op = s.charAt(i); if (op != '*' && op != '/' && op != '%') return v; i++; Double r = num(); if (op == '*') v *= r; else if (op == '/') { if (r == 0) throw new IllegalArgumentException(); v /= r; } else v %= r; }
        }
        private Double add() {
            Double v = mul();
            for (;;) { skip(); if (i >= s.length()) return v; char op = s.charAt(i); if (op != '+' && op != '-') return v; i++; Double r = mul(); v = op == '+' ? v + r : v - r; }
        }
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
                // pointVar：指向一个 point 类型变量时按该点坐标点
                if (st.has("pointVar")) {
                    Object pv = vars.get(st.optString("pointVar"));
                    if (pv instanceof JSONObject) {
                        JSONObject p = (JSONObject) pv;
                        if (p.has("x") && p.has("y")) {
                            DisplayMetrics m = s.getResources().getDisplayMetrics();
                            return s.tap((int) (p.optDouble("x") * m.widthPixels), (int) (p.optDouble("y") * m.heightPixels), st.optBoolean("long") ? 700 : 60) ? null : "点击失败";
                        }
                    }
                    return "变量 " + st.optString("pointVar") + " 不是 point 类型";
                }
                AccessibilityNodeInfo n = sel == null ? null : waitFind(sel, timeout);
                if (n != null) return clickNode(n, st.optBoolean("long")) ? null : "点击失败";
                if (st.has("x") && (sel == null || st.optBoolean("coordFallback", true))) return tapRatio(st) ? null : "点击失败";
                return "找不到按钮";
            }
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
