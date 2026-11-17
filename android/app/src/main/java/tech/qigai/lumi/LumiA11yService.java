package tech.qigai.lumi;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** 栖语 Lumi 手机操控：读屏幕元素、点击、输入、滑动。只有用户在系统设置里打开后才会运行。 */
public class LumiA11yService extends AccessibilityService {
    static volatile LumiA11yService instance;
    private final List<AccessibilityNodeInfo> nodes = new ArrayList<>();

    @Override protected void onServiceConnected() { instance = this; }
    @Override public void onDestroy() { instance = null; super.onDestroy(); }
    @Override public boolean onUnbind(android.content.Intent i) { instance = null; return super.onUnbind(i); }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) { }
    @Override public void onInterrupt() { }

    /** 当前屏幕的可交互元素，一行一个：[编号] 类型 "文字" (描述) {可点/可输入/可滚动} @中心坐标 */
    synchronized String dump(int max) {
        nodes.clear();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "（读不到当前屏幕，可能在锁屏或系统界面）";
        StringBuilder sb = new StringBuilder();
        CharSequence pkg = root.getPackageName();
        sb.append("当前应用：").append(pkg == null ? "未知" : pkg).append('\n');
        Rect scr = new Rect(); root.getBoundsInScreen(scr);
        sb.append("屏幕：").append(scr.width()).append('x').append(scr.height()).append('\n');
        walk(root, sb, 0, max);
        if (nodes.isEmpty()) sb.append("（这个界面没有可读的元素）");
        return sb.toString();
    }

    private void walk(AccessibilityNodeInfo n, StringBuilder sb, int depth, int max) {
        if (n == null || nodes.size() >= max || depth > 40) return;
        if (!n.isVisibleToUser()) return;
        CharSequence t = n.getText(), d = n.getContentDescription();
        String text = t == null ? "" : t.toString().trim(), desc = d == null ? "" : d.toString().trim();
        boolean click = n.isClickable() || n.isLongClickable(), edit = n.isEditable(), scroll = n.isScrollable(), check = n.isCheckable();
        if (click || edit || scroll || !text.isEmpty() || !desc.isEmpty()) {
            Rect r = new Rect(); n.getBoundsInScreen(r);
            if (r.width() > 0 && r.height() > 0) {
                int id = nodes.size(); nodes.add(n);
                String cls = n.getClassName() == null ? "View" : n.getClassName().toString();
                cls = cls.substring(cls.lastIndexOf('.') + 1);
                sb.append('[').append(id).append("] ").append(cls);
                if (!text.isEmpty()) sb.append(" \"").append(cut(text)).append('"');
                if (!desc.isEmpty() && !desc.equals(text)) sb.append(" (").append(cut(desc)).append(')');
                StringBuilder f = new StringBuilder();
                if (click) f.append("可点,");
                if (edit) f.append("可输入,");
                if (scroll) f.append("可滚动,");
                if (check) f.append(n.isChecked() ? "已选中," : "未选中,");
                if (n.isFocused()) f.append("焦点,");
                if (f.length() > 0) sb.append(" {").append(f.substring(0, f.length() - 1)).append('}');
                sb.append(" @").append(r.centerX()).append(',').append(r.centerY()).append('\n');
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), sb, depth + 1, max);
    }

    private static String cut(String s) { s = s.replace('\n', ' '); return s.length() > 60 ? s.substring(0, 60) + "…" : s; }

    synchronized AccessibilityNodeInfo node(int id) { return id >= 0 && id < nodes.size() ? nodes.get(id) : null; }

    synchronized Rect bounds(int id) { AccessibilityNodeInfo n = node(id); if (n == null) return null; Rect r = new Rect(); n.getBoundsInScreen(r); return r; }

    boolean click(int id, boolean longPress) {
        AccessibilityNodeInfo n = node(id);
        if (n == null) return false;
        int act = longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
        for (AccessibilityNodeInfo p = n; p != null; p = p.getParent()) {
            if ((longPress ? p.isLongClickable() : p.isClickable()) && p.performAction(act)) return true;
        }
        Rect r = bounds(id);
        return r != null && tap(r.centerX(), r.centerY(), longPress ? 700 : 60);
    }

    boolean tap(int x, int y, long ms) {
        Path p = new Path(); p.moveTo(x, y);
        return gesture(new GestureDescription.StrokeDescription(p, 0, Math.max(1, ms)));
    }

    boolean swipe(int x1, int y1, int x2, int y2, long ms) {
        Path p = new Path(); p.moveTo(x1, y1); p.lineTo(x2, y2);
        return gesture(new GestureDescription.StrokeDescription(p, 0, Math.max(50, ms)));
    }

    private boolean gesture(GestureDescription.StrokeDescription s) {
        final boolean[] ok = { false };
        final CountDownLatch done = new CountDownLatch(1);
        boolean sent = dispatchGesture(new GestureDescription.Builder().addStroke(s).build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription g) { ok[0] = true; done.countDown(); }
            @Override public void onCancelled(GestureDescription g) { done.countDown(); }
        }, null);
        if (!sent) return false;
        try { done.await(3, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        return ok[0];
    }

    boolean input(int id, String text) {
        AccessibilityNodeInfo n = id >= 0 ? node(id) : null;
        if (n == null) {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) n = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        }
        if (n == null) return false;
        if (!n.isFocused()) n.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
    }

    boolean scroll(int id, boolean forward) {
        AccessibilityNodeInfo n = node(id);
        for (AccessibilityNodeInfo p = n; p != null; p = p.getParent())
            if (p.isScrollable() && p.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) return true;
        return false;
    }

    boolean global(String what) {
        switch (what) {
            case "back": return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home": return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents": return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notifications": return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quick_settings": return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            default: return false;
        }
    }
}
