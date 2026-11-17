package tech.qigai.lumi;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Flow 解释器（v0.17）。纯 Java + org.json，不依赖 Android，真机动作交给 {@link Host}（LumiFlow 实现），
 * 所以可以在普通 JVM 上单测（scripts/flowvm-test/）。
 *
 * 控制步：if/else/endif、while/endwhile、do/dowhile、for/endfor、break/continue、set、
 * new（实例化类，TS 侧 expandCalls 已把类的字段默认值写进 fields）、bind/unbind（方法调用：TS 侧把
 * obj.method() 展开成 bind + 方法体 + unbind，bind 把 this 绑到对象、把实参写进变量并在 unbind 时恢复）。
 * call/method 应已在 TS 侧内联，走到这里说明调用过深或循环调用，直接报错。
 *
 * 变量：数字（Double）、字符串、point（{x,y}）、struct / 对象（JSONObject，对象带 __class）、数组。
 * 路径：a.b.c 可以读写对象字段，this.x 指当前方法绑定的对象。${路径} 在文字里插值。
 */
public class FlowVm {

    /** 真机动作由宿主提供。 */
    public interface Host {
        boolean stopped();
        void progress(int pc, int total, String label);
        /** confirm 步：返回 false 表示用户选择停止。 */
        boolean confirm(String label);
        /** 元素是否存在；waitMs=0 只查一次。 */
        boolean exists(JSONObject sel, long waitMs);
        /** 当前屏幕文字（text 条件用）。 */
        String screenText();
        /** 执行一个动作步（已插值），成功返回 null，失败返回原因。 */
        String act(JSONObject step, int pc);
        /** 刚执行的动作是怎么完成的：native（无障碍选择器）/ vision（AI 视觉）/ coord（坐标兜底）。 */
        String lastSrc();
        /** 步后等待。 */
        void settle(long ms);
        /** 下一步需要视觉时提前截图（可空实现）。 */
        void prefetch(JSONObject next);
    }

    public static final int MAX_EXEC_STEPS = 500;
    public static final int MAX_LOOP_DEPTH = 8;
    public static final int DEFAULT_LOOP_MAX = 20;
    public static final int MAX_FOR_ITER = 1000;

    final Map<String, Object> vars = new LinkedHashMap<>();
    private final Deque<JSONObject> thisStack = new ArrayDeque<>();
    private final Deque<Map<String, Object>> savedArgs = new ArrayDeque<>();
    public boolean fast;
    private String controlError = "";
    private static final Object ABSENT = new Object();

    private static class Frame {
        String type; int startPc; boolean taken;
        JSONObject cond; int iter; int max = DEFAULT_LOOP_MAX;
        String var; double cur, end, step;
    }

    /* ======================================================== 运行 */

    /** 返回 {ok, done, total, failedAt, reason, log[], ms, stepMs[], trace[{pc,i,fid,label,ms,src}]}。 */
    public JSONObject run(JSONArray steps, JSONObject initVars, Host h) {
        host = h;
        vars.clear(); thisStack.clear(); savedArgs.clear();
        if (initVars != null) {
            Iterator<String> it = initVars.keys();
            while (it.hasNext()) { String k = it.next(); vars.put(k, norm(initVars.opt(k))); }
        }
        JSONObject res = new JSONObject();
        JSONArray log = new JSONArray(), stepMs = new JSONArray(), trace = new JSONArray();
        int n = steps.length();
        long t0 = System.currentTimeMillis();
        int executed = 0;
        boolean userStop = false;
        Deque<Frame> stack = new ArrayDeque<>();
        try {
            res.put("total", n);
            int pc = 0;
            while (pc < n && !h.stopped()) {
                if (++executed > MAX_EXEC_STEPS) return fail(res, log, stepMs, trace, pc, executed, "执行步数超过 " + MAX_EXEC_STEPS + " 步，可能死循环", t0);
                JSONObject st = steps.getJSONObject(pc);
                String kind = st.optString("kind");
                String lb = label(st);
                h.progress(pc, n, lb);
                long s0 = System.currentTimeMillis();
                if (isControl(kind)) {
                    int next = control(st, steps, pc, stack, lb);
                    if (next < 0) return fail(res, log, stepMs, trace, pc, executed, controlError, t0);
                    long took = System.currentTimeMillis() - s0;
                    stepMs.put(took);
                    if (!isSilentControl(kind)) { log.put(lb + " · " + took + "ms"); trace.put(tr(st, pc, lb, took, "logic")); }
                    pc = next;
                    continue;
                }
                JSONObject rs = resolveStep(st);
                if (rs == null) return fail(res, log, stepMs, trace, pc, executed, lb + "：" + controlError, t0);
                if (st.optBoolean("confirm") && !h.confirm(lb)) { userStop = true; break; }
                String err = h.act(rs, pc);
                long took = System.currentTimeMillis() - s0;
                stepMs.put(took);
                String src = err == null ? h.lastSrc() : "fail";
                if (err != null && st.optBoolean("optional")) {
                    log.put("跳过：" + lb + " · " + took + "ms"); trace.put(tr(st, pc, lb, took, "skip"));
                    pc++; continue;
                }
                if (err != null) { trace.put(tr(st, pc, lb, took, "fail")); return fail(res, log, stepMs, trace, pc, executed, lb + "：" + err, t0); }
                log.put(lb + " · " + took + "ms");
                trace.put(tr(st, pc, lb, took, src));
                if (pc + 1 < n) h.prefetch(steps.optJSONObject(pc + 1));
                h.settle(st.has("after") ? st.optInt("after") : (fast ? 120 : 450));
                pc++;
            }
            boolean stopped = userStop || h.stopped();
            res.put("ok", !stopped);
            res.put("done", executed);
            res.put("log", log); res.put("stepMs", stepMs); res.put("trace", trace);
            res.put("ms", System.currentTimeMillis() - t0);
            if (stopped) res.put("reason", "用户停止了");
            res.put("vars", varsJson());
        } catch (Exception e) {
            try {
                res.put("ok", false); res.put("reason", String.valueOf(e.getMessage())); res.put("failedAt", 0);
                res.put("ms", System.currentTimeMillis() - t0); res.put("stepMs", stepMs); res.put("trace", trace); res.put("log", log);
            } catch (Exception ignored) { }
        }
        return res;
    }

    private JSONObject tr(JSONObject st, int pc, String lb, long ms, String src) {
        JSONObject o = new JSONObject();
        try {
            o.put("pc", pc); o.put("label", lb); o.put("ms", ms); o.put("src", src);
            if (st.has("_i")) o.put("i", st.optInt("_i"));
            if (st.has("_fid")) o.put("fid", st.optString("_fid"));
        } catch (Exception ignored) { }
        return o;
    }

    private JSONObject fail(JSONObject res, JSONArray log, JSONArray stepMs, JSONArray trace, int pc, int executed, String reason, long t0) {
        try {
            res.put("ok", false); res.put("failedAt", pc); res.put("reason", reason);
            res.put("done", executed); res.put("log", log); res.put("stepMs", stepMs); res.put("trace", trace);
            res.put("ms", System.currentTimeMillis() - t0);
            res.put("vars", varsJson());
        } catch (Exception ignored) { }
        return res;
    }

    private JSONObject varsJson() {
        JSONObject o = new JSONObject();
        for (Map.Entry<String, Object> e : vars.entrySet()) { try { o.put(e.getKey(), e.getValue()); } catch (Exception ignored) { } }
        return o;
    }

    static boolean isControl(String kind) {
        switch (kind) {
            case "if": case "else": case "endif": case "while": case "endwhile":
            case "do": case "dowhile": case "for": case "endfor":
            case "break": case "continue": case "set": case "call":
            case "new": case "method": case "bind": case "unbind":
                return true;
            default: return false;
        }
    }
    private static boolean isSilentControl(String kind) {
        return kind.equals("endif") || kind.equals("endwhile") || kind.equals("endfor") || kind.equals("unbind");
    }

    /* ======================================================== 控制流 */

    private static int findMatch(JSONArray steps, int pc, String open, String close, String alt) {
        int depth = 0;
        for (int i = pc; i < steps.length(); i++) {
            JSONObject o = steps.optJSONObject(i);
            String k = o == null ? "" : o.optString("kind");
            if (k.equals(open)) depth++;
            else if (alt != null && k.equals(alt) && depth == 1) return i;
            else if (k.equals(close)) { depth--; if (depth == 0) return i; }
        }
        return -1;
    }
    private static int loopEndPc(JSONArray steps, Frame f) {
        switch (f.type) {
            case "WHILE": return findMatch(steps, f.startPc, "while", "endwhile", null);
            case "FOR": return findMatch(steps, f.startPc, "for", "endfor", null);
            default: return findMatch(steps, f.startPc, "do", "dowhile", null);
        }
    }
    private static int loops(Deque<Frame> stack) {
        int c = 0;
        for (Frame f : stack) if (!f.type.equals("IF")) c++;
        return c;
    }
    private static Frame nearestLoop(Deque<Frame> stack) {
        for (Frame f : stack) if (!f.type.equals("IF")) return f;
        return null;
    }
    private static boolean pastEnd(Frame f) { return f.step > 0 ? f.cur > f.end : f.cur < f.end; }
    private int skipTo(JSONArray steps, int end) { return end < 0 ? steps.length() : end + 1; }

    private int control(JSONObject st, JSONArray steps, int pc, Deque<Frame> stack, String lb) {
        String kind = st.optString("kind");
        controlError = "";
        switch (kind) {
            case "if": {
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) return err(lb + "：缺少 cond 条件");
                Boolean c = evalCond(cond); if (c == null) return -1;
                if (c) { Frame f = new Frame(); f.type = "IF"; f.startPc = pc; f.taken = true; stack.push(f); return pc + 1; }
                int els = findMatch(steps, pc, "if", "endif", "else");
                if (els < 0) return err(lb + "：没有对应的 endif");
                if ("else".equals(steps.optJSONObject(els).optString("kind"))) {
                    Frame f = new Frame(); f.type = "IF"; f.startPc = pc; f.taken = false; stack.push(f);
                }
                return els + 1;
            }
            case "else": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("IF")) return err(lb + "：没有对应的 if");
                // 走到 else 说明 then 分支执行完了：跳过 else 分支
                stack.pop();
                return skipTo(steps, findMatch(steps, f.startPc, "if", "endif", null));
            }
            case "endif": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("IF")) return err(lb + "：没有对应的 if");
                stack.pop();
                return pc + 1;
            }
            case "while": {
                Frame top = stack.peek();
                if (top != null && top.type.equals("WHILE") && top.startPc == pc) {
                    Boolean c = evalCond(top.cond); if (c == null) return -1;
                    if (!c) { stack.pop(); return skipTo(steps, findMatch(steps, pc, "while", "endwhile", null)); }
                    return pc + 1;
                }
                if (loops(stack) >= MAX_LOOP_DEPTH) return err(lb + "：循环嵌套超过 " + MAX_LOOP_DEPTH + " 层");
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) return err(lb + "：缺少 cond 条件");
                Boolean c = evalCond(cond); if (c == null) return -1;
                if (!c) return skipTo(steps, findMatch(steps, pc, "while", "endwhile", null));
                Frame f = new Frame(); f.type = "WHILE"; f.startPc = pc; f.cond = cond; f.max = st.optInt("max", DEFAULT_LOOP_MAX); stack.push(f);
                return pc + 1;
            }
            case "endwhile": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("WHILE")) return err(lb + "：没有对应的 while");
                if (++f.iter >= f.max) {
                    // 已跑满 max 轮：条件仍成立就报错，不成立正常退出
                    Boolean c = evalCond(f.cond); if (c == null) return -1;
                    if (c) return err("循环超过 " + f.max + " 次（可在 while 步上设 max）");
                    stack.pop(); return pc + 1;
                }
                return f.startPc;
            }
            case "do": {
                if (loops(stack) >= MAX_LOOP_DEPTH) return err(lb + "：循环嵌套超过 " + MAX_LOOP_DEPTH + " 层");
                Frame f = new Frame(); f.type = "DO"; f.startPc = pc; f.max = st.optInt("max", DEFAULT_LOOP_MAX); stack.push(f);
                return pc + 1;
            }
            case "dowhile": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("DO")) return err(lb + "：没有对应的 do");
                JSONObject cond = st.optJSONObject("cond");
                if (cond == null) return err(lb + "：缺少 cond 条件");
                Boolean c = evalCond(cond); if (c == null) return -1;
                if (c) {
                    if (++f.iter >= f.max) return err("循环超过 " + f.max + " 次（可在 do 步上设 max）");
                    return f.startPc + 1;
                }
                stack.pop();
                return pc + 1;
            }
            case "for": {
                Frame top = stack.peek();
                if (top != null && top.type.equals("FOR") && top.startPc == pc) {
                    if (pastEnd(top)) { stack.pop(); return skipTo(steps, findMatch(steps, pc, "for", "endfor", null)); }
                    vars.put(top.var, top.cur);
                    return pc + 1;
                }
                if (loops(stack) >= MAX_LOOP_DEPTH) return err(lb + "：循环嵌套超过 " + MAX_LOOP_DEPTH + " 层");
                if (!st.has("var") || !st.has("from") || !st.has("to")) return err(lb + "：for 缺少 var/from/to");
                Double from = numArg(st.opt("from")), to = numArg(st.opt("to"));
                if (from == null || to == null) return err(lb + "：for 的 from/to 不是数字");
                Double step = st.has("step") ? numArg(st.opt("step")) : Double.valueOf(to >= from ? 1 : -1);
                if (step == null || step == 0) return err(lb + "：for 的 step 不能为 0");
                Frame f = new Frame(); f.type = "FOR"; f.startPc = pc; f.var = st.optString("var");
                f.cur = from; f.end = to; f.step = step;
                long count = (long) Math.floor(Math.abs(to - from) / Math.abs(step)) + 1;
                // for 有明确端点，默认上限按区间算（最多 1000 次），max 可再收紧
                f.max = st.has("max") ? st.optInt("max") : (int) Math.min(MAX_FOR_ITER, Math.max(1, count));
                if (pastEnd(f)) return skipTo(steps, findMatch(steps, pc, "for", "endfor", null));
                vars.put(f.var, f.cur);
                stack.push(f);
                return pc + 1;
            }
            case "endfor": {
                Frame f = stack.peek();
                if (f == null || !f.type.equals("FOR")) return err(lb + "：没有对应的 for");
                f.cur += f.step;
                if (++f.iter >= f.max && !pastEnd(f)) return err("循环超过 " + f.max + " 次（可在 for 步上设 max）");
                return f.startPc;
            }
            case "break": {
                Frame loop = nearestLoop(stack);
                if (loop == null) return err(lb + "：不在任何循环里");
                while (!stack.isEmpty()) { Frame f = stack.pop(); if (f == loop) break; }
                return skipTo(steps, loopEndPc(steps, loop));
            }
            case "continue": {
                Frame loop = nearestLoop(stack);
                if (loop == null) return err(lb + "：不在任何循环里");
                while (!stack.isEmpty() && stack.peek() != loop) stack.pop();
                int end = loopEndPc(steps, loop);
                // 跳到循环尾步（endwhile/endfor/dowhile）上执行，复用那里的计数与判断
                return end < 0 ? steps.length() : end;
            }
            case "set": {
                String v = st.optString("var", "");
                if (v.isEmpty()) return err(lb + "：set 缺少 var");
                Object val;
                try { val = evalValue(st.optString("value", "")); } catch (Exception e) { return err(lb + "：变量求值失败"); }
                return assign(v, val) ? pc + 1 : err(lb + "：" + controlError);
            }
            case "new": {
                String v = st.optString("var", "");
                if (v.isEmpty()) return err(lb + "：new 缺少 var");
                JSONObject o = new JSONObject();
                try {
                    o.put("__class", st.optString("cls"));
                    JSONObject fields = st.optJSONObject("fields");
                    if (fields != null) for (Iterator<String> it = fields.keys(); it.hasNext(); ) { String k = it.next(); o.put(k, valueOf(fields.opt(k))); }
                    JSONObject args = st.optJSONObject("args");
                    if (args != null) for (Iterator<String> it = args.keys(); it.hasNext(); ) { String k = it.next(); o.put(k, valueOf(args.opt(k))); }
                } catch (Exception e) { return err(lb + "：创建对象失败"); }
                return assign(v, o) ? pc + 1 : err(lb + "：" + controlError);
            }
            case "bind": {
                String v = st.optString("var", "");
                Object obj = resolvePath(v);
                if (!(obj instanceof JSONObject)) return err(lb + "：" + v + " 不是对象（先用 new 创建）");
                JSONObject o = (JSONObject) obj;
                String cls = st.optString("cls", "");
                if (!cls.isEmpty() && !cls.equals(o.optString("__class"))) return err(lb + "：" + v + " 是 " + o.optString("__class", "struct") + "，没有方法 " + st.optString("method"));
                // 实参在调用方作用域里求值，再绑定 this
                Map<String, Object> saved = new HashMap<>();
                Map<String, Object> vals = new LinkedHashMap<>();
                JSONObject args = st.optJSONObject("args");
                if (args != null) for (Iterator<String> it = args.keys(); it.hasNext(); ) { String k = it.next(); vals.put(k, valueOf(args.opt(k))); }
                for (Map.Entry<String, Object> e : vals.entrySet()) {
                    saved.put(e.getKey(), vars.containsKey(e.getKey()) ? vars.get(e.getKey()) : ABSENT);
                    vars.put(e.getKey(), e.getValue());
                }
                savedArgs.push(saved);
                thisStack.push(o);
                return pc + 1;
            }
            case "unbind": {
                if (thisStack.isEmpty()) return err(lb + "：没有对应的方法调用");
                thisStack.pop();
                Map<String, Object> saved = savedArgs.isEmpty() ? null : savedArgs.pop();
                if (saved != null) for (Map.Entry<String, Object> e : saved.entrySet()) {
                    if (e.getValue() == ABSENT) vars.remove(e.getKey()); else vars.put(e.getKey(), e.getValue());
                }
                return pc + 1;
            }
            case "call": return err(lb + "：子流程未展开（调用层数过深、循环调用或目标不存在）");
            case "method": return err(lb + "：方法未展开（找不到类或方法，或调用层数过深）");
            default: return err("不认识的步骤 " + kind);
        }
    }
    private int err(String m) { controlError = m; return -1; }

    private Double numArg(Object o) {
        if (o instanceof Number) return ((Number) o).doubleValue();
        if (o instanceof String) return toNum(evalValue((String) o));
        return null;
    }
    private Object valueOf(Object raw) {
        if (raw instanceof String) return evalValue((String) raw);
        return norm(raw);
    }
    private static Object norm(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        return v == null || v == JSONObject.NULL ? "" : v;
    }

    /* ======================================================== 条件 */

    private Host host;
    void setHost(Host h) { host = h; }

    /** 返回 null 表示出错（原因在 controlError）。 */
    private Boolean evalCond(JSONObject c) {
        if (c == null) { controlError = "缺少条件"; return null; }
        String k = c.optString("kind");
        long wait = c.optLong("timeout", 0);
        switch (k) {
            case "exists": return host != null && host.exists(interpSel(c.optJSONObject("sel")), wait);
            case "not_exists": return host == null || !host.exists(interpSel(c.optJSONObject("sel")), wait);
            case "text": return host != null && host.screenText().contains(interp(c.optString("text", "")));
            case "var": {
                Object v = resolvePath(c.optString("var"));
                String op = c.optString("op", "==");
                String rhs = interp(c.optString("value", ""));
                if (v == null) return op.equals("!=") ? !rhs.isEmpty() : (op.equals("==") && rhs.isEmpty());
                return compare(v, op, rhs);
            }
            default: controlError = "不认识的条件 " + k; return null;
        }
    }
    static boolean compare(Object v, String op, String rhs) {
        if (op.equals("contains")) return varString(v).contains(rhs);
        Double vn = toNum(v), rn = toNum(rhs);
        if (vn != null && rn != null) {
            switch (op) {
                case "==": return vn.doubleValue() == rn.doubleValue();
                case "!=": return vn.doubleValue() != rn.doubleValue();
                case ">": return vn > rn;
                case "<": return vn < rn;
                case ">=": return vn >= rn;
                case "<=": return vn <= rn;
                default: return false;
            }
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

    /* ======================================================== 变量与路径 */

    static final String PATH = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";
    private static final Pattern INTERP = Pattern.compile("\\$\\{(" + PATH + ")\\}");
    private static final Pattern PATH_RE = Pattern.compile(PATH);
    private static final Pattern NUM = Pattern.compile("-?\\d+(\\.\\d+)?");
    private static final Pattern POINT = Pattern.compile("^(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$");

    /** 读路径：a / a.b.c / this.x；数组可以用数字下标 a.0（下标写成字段）。读不到返回 null。 */
    Object resolvePath(String path) {
        if (path == null || path.isEmpty()) return null;
        String[] parts = path.split("\\.");
        Object cur = parts[0].equals("this") ? thisStack.peek() : vars.get(parts[0]);
        for (int i = 1; i < parts.length && cur != null; i++) {
            if (cur instanceof JSONObject) { Object x = ((JSONObject) cur).opt(parts[i]); cur = x == JSONObject.NULL ? null : x; }
            else if (cur instanceof JSONArray && parts[i].matches("\\d+")) cur = ((JSONArray) cur).opt(Integer.parseInt(parts[i]));
            else cur = null;
        }
        return cur;
    }
    /** 写路径：a = v，或 a.b = v（a 必须是对象）。 */
    boolean assign(String path, Object val) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) {
            if (path.equals("this")) { controlError = "不能给 this 赋值"; return false; }
            vars.put(path, val); return true;
        }
        Object parent = resolvePath(path.substring(0, dot));
        if (!(parent instanceof JSONObject)) { controlError = path.substring(0, dot) + " 不是对象，不能设置字段"; return false; }
        try { ((JSONObject) parent).put(path.substring(dot + 1), val); return true; }
        catch (Exception e) { controlError = "字段赋值失败"; return false; }
    }

    static String numStr(double d) {
        if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) return String.valueOf((long) d);
        return String.valueOf(d);
    }
    static String varString(Object v) {
        if (v == null) return "";
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v;
            if (o.has("x") && o.has("y") && o.length() == 2) return numStr(o.optDouble("x")) + "," + numStr(o.optDouble("y"));
            return o.toString();
        }
        if (v instanceof Number) return numStr(((Number) v).doubleValue());
        return String.valueOf(v);
    }
    static Double toNum(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof String && NUM.matcher(((String) v).trim()).matches()) return Double.parseDouble(((String) v).trim());
        return null;
    }

    String interp(String raw) {
        if (raw == null) return "";
        Matcher m = INTERP.matcher(raw);
        StringBuffer sb = new StringBuffer();
        while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement(varString(resolvePath(m.group(1)))));
        m.appendTail(sb);
        return sb.toString();
    }

    /**
     * set / new / 实参的值求值：${路径} 插值 → struct/数组 JSON → point "0.5,0.3" → 数字 →
     * 单独的对象路径（p.price、this.count，带点才算，裸词仍当文字以兼容 v0.16）→ 字符串拼接 → 四则 → 原文字。
     */
    Object evalValue(String raw) {
        String t = interp(raw).trim();
        if (t.isEmpty()) return "";
        if (t.startsWith("{")) { try { return new JSONObject(t); } catch (Exception ignored) { } }
        if (t.startsWith("[")) { try { return new JSONArray(t); } catch (Exception ignored) { } }
        Matcher pt = POINT.matcher(t);
        if (pt.matches()) {
            try { JSONObject o = new JSONObject(); o.put("x", Double.parseDouble(pt.group(1))); o.put("y", Double.parseDouble(pt.group(2))); return o; } catch (Exception ignored) { }
        }
        if (NUM.matcher(t).matches()) return Double.parseDouble(t);
        if (t.contains(".") && t.matches(PATH)) {
            Object v = resolvePath(t);
            if (v != null) return copy(v);
        }
        if (t.contains("+")) {
            String[] parts = t.split("\\+", -1);
            StringBuilder sb = new StringBuilder();
            boolean allKnown = true, anyString = false;
            for (String p : parts) {
                String q = p.trim();
                if (q.length() >= 2 && ((q.startsWith("\"") && q.endsWith("\"")) || (q.startsWith("'") && q.endsWith("'")))) { sb.append(q, 1, q.length() - 1); anyString = true; }
                else if (q.matches(PATH) && resolvePath(q) != null) { Object v = resolvePath(q); sb.append(varString(v)); if (toNum(v) == null) anyString = true; }
                else if (NUM.matcher(q).matches()) sb.append(q);
                else { allKnown = false; break; }
            }
            if (allKnown && anyString) return sb.toString();
        }
        if (t.matches("[\\d\\s+\\-*/%().A-Za-z_]+") && t.matches(".*[+\\-*/%()].*")) {
            Matcher m = PATH_RE.matcher(t);
            StringBuffer sb = new StringBuffer();
            boolean ok = true;
            while (m.find()) {
                Double d = toNum(resolvePath(m.group()));
                if (d == null) { ok = false; break; }
                m.appendReplacement(sb, Matcher.quoteReplacement(d < 0 ? "(" + numStr(d) + ")" : numStr(d)));
            }
            if (ok) {
                m.appendTail(sb);
                Double d = evalArith(sb.toString());
                if (d != null && !d.isNaN() && !d.isInfinite()) return d;
            }
        }
        return t;
    }
    private static Object copy(Object v) {
        try {
            if (v instanceof JSONObject) return new JSONObject(v.toString());
            if (v instanceof JSONArray) return new JSONArray(v.toString());
        } catch (Exception ignored) { }
        return v;
    }

    /** 动作步插值：text / goal / note / sel 文字里的 ${…}；pointVar 换成坐标。失败返回 null（原因在 controlError）。 */
    JSONObject resolveStep(JSONObject st) {
        try {
            JSONObject o = new JSONObject(st.toString());
            for (String k : new String[] { "text", "goal", "note", "app" }) if (o.has(k)) o.put(k, interp(o.optString(k)));
            if (o.has("sel")) o.put("sel", interpSel(o.optJSONObject("sel")));
            if (o.has("pointVar")) {
                String pv = o.optString("pointVar");
                Object p = resolvePath(pv);
                if (!(p instanceof JSONObject) || !((JSONObject) p).has("x") || !((JSONObject) p).has("y")) { controlError = "变量 " + pv + " 不是 point 类型"; return null; }
                o.put("x", ((JSONObject) p).optDouble("x")); o.put("y", ((JSONObject) p).optDouble("y"));
                o.remove("sel"); o.put("coordOnly", true);
            }
            return o;
        } catch (Exception e) { controlError = "步骤解析失败"; return null; }
    }
    private JSONObject interpSel(JSONObject sel) {
        if (sel == null) return null;
        try {
            JSONObject o = new JSONObject(sel.toString());
            for (String k : new String[] { "id", "text", "desc" }) if (o.has(k)) o.put(k, interp(o.optString(k)));
            return o;
        } catch (Exception e) { return sel; }
    }

    /* ======================================================== 四则 */

    static Double evalArith(String expr) {
        try { return new Arith(expr).parse(); } catch (Exception e) { return null; }
    }
    private static class Arith {
        private final String s; private int i;
        Arith(String s) { this.s = s; }
        Double parse() { double v = add(); skip(); if (i != s.length()) throw new IllegalArgumentException(); return v; }
        private void skip() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        private double unary() {
            skip();
            if (i < s.length() && s.charAt(i) == '-') { i++; return -unary(); }
            if (i < s.length() && s.charAt(i) == '(') { i++; double v = add(); skip(); if (i >= s.length() || s.charAt(i) != ')') throw new IllegalArgumentException(); i++; return v; }
            int st = i;
            while (i < s.length() && (Character.isDigit(s.charAt(i)) || s.charAt(i) == '.')) i++;
            if (i == st) throw new IllegalArgumentException();
            return Double.parseDouble(s.substring(st, i));
        }
        private double mul() {
            double v = unary();
            for (;;) {
                skip(); if (i >= s.length()) return v;
                char op = s.charAt(i); if (op != '*' && op != '/' && op != '%') return v;
                i++; double r = unary();
                if (op == '*') v *= r; else if (op == '/') { if (r == 0) throw new IllegalArgumentException(); v /= r; } else { if (r == 0) throw new IllegalArgumentException(); v %= r; }
            }
        }
        private double add() {
            double v = mul();
            for (;;) {
                skip(); if (i >= s.length()) return v;
                char op = s.charAt(i); if (op != '+' && op != '-') return v;
                i++; double r = mul(); v = op == '+' ? v + r : v - r;
            }
        }
    }

    /* ======================================================== 文字 */

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
    static String selText(JSONObject sel) {
        if (sel == null) return "";
        String t = sel.optString("text", "");
        if (t.isEmpty()) t = sel.optString("desc", "");
        return t.isEmpty() ? sel.optString("id", "") : t;
    }
    private static String argsText(JSONObject a) {
        if (a == null || a.length() == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (Iterator<String> it = a.keys(); it.hasNext(); ) { String k = it.next(); if (sb.length() > 0) sb.append(", "); sb.append(k).append('=').append(a.optString(k)); }
        return sb.toString();
    }

    static String label(JSONObject st) {
        if (!st.optString("note").isEmpty()) return st.optString("note");
        String k = st.optString("kind");
        String what = selText(st.optJSONObject("sel"));
        switch (k) {
            case "launch": return "打开 " + (st.optString("app").isEmpty() ? st.optString("pkg") : st.optString("app"));
            case "tap": return (st.optBoolean("long") ? "长按" : "点击") + (st.has("pointVar") ? "变量点 " + st.optString("pointVar") : what.isEmpty() ? "" : "「" + what + "」");
            case "input": return "输入「" + st.optString("text") + "」";
            case "enter": return "回车 / 搜索";
            case "scroll": return st.optBoolean("forward", true) ? "向下滚动" : "向上滚动";
            case "swipe": return "滑动";
            case "key": return "按键 " + st.optString("key");
            case "wait": return "等待「" + what + "」出现";
            case "sleep": return "等 " + numStr(st.optInt("ms", 1000) / 1000.0) + " 秒";
            case "ai": return "AI 找「" + st.optString("goal") + "」并" + ("input".equals(st.optString("act")) ? "输入" : "long".equals(st.optString("act")) ? "长按" : "点击");
            case "if": return "如果 " + condLabel(st.optJSONObject("cond"));
            case "else": return "否则";
            case "endif": return "条件结束";
            case "while": return "循环：当 " + condLabel(st.optJSONObject("cond"));
            case "endwhile": return "循环结束";
            case "do": return "先执行一次";
            case "dowhile": return "重复执行，当 " + condLabel(st.optJSONObject("cond"));
            case "for": return "循环 " + st.optString("var") + " 从 " + st.opt("from") + " 到 " + st.opt("to");
            case "endfor": return "循环结束";
            case "break": return "跳出循环";
            case "continue": return "继续下一轮";
            case "set": return "设置 " + st.optString("var") + " = " + st.optString("value");
            case "call": return "调用子流程 " + st.optString("flowId");
            case "new": return "新建 " + st.optString("var") + " = " + st.optString("cls") + "(" + argsText(st.optJSONObject("args")) + ")";
            case "method": return "调用 " + st.optString("var") + "." + st.optString("method") + "(" + argsText(st.optJSONObject("args")) + ")";
            case "bind": return "进入 " + st.optString("var") + "." + st.optString("method") + "()";
            case "unbind": return "方法返回";
            default: return k;
        }
    }
}
