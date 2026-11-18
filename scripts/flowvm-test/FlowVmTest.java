import org.json.JSONArray;
import org.json.JSONObject;
import tech.qigai.lumi.FlowVm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * FlowVm 单测：在普通 JVM 上跑解释器，用假的 Host 代替真机。
 * 运行：scripts/flowvm-test/run.sh（需要 JDK 17+，脚本会下载 org.json）。
 * 还会读 scripts/flowvm-test/expanded.json（由 scripts/flow-test.mts 用 TS 的 expandCalls 生成），验证 TS 展开 → Java 执行端到端。
 */
public class FlowVmTest {
    static int pass = 0, failN = 0;

    static class FakeHost implements FlowVm.Host {
        final Set<String> screen = new HashSet<>();
        final List<String> acts = new ArrayList<>();
        int existsCalls = 0;
        /** 每次点击「下一页」后把它从屏幕上去掉的次数（模拟翻页 N 次后到底）。 */
        int pagesLeft = 0;
        public boolean stopped() { return false; }
        public void progress(int pc, int total, String label) { }
        public boolean confirm(String label) { return true; }
        public boolean exists(JSONObject sel, long waitMs) { existsCalls++; return sel != null && screen.contains(sel.optString("text")); }
        public String screenText() { return String.join("\n", screen); }
        public String act(JSONObject st, int pc) {
            String k = st.optString("kind");
            String d = k;
            if (st.has("sel")) d += ":" + st.optJSONObject("sel").optString("text");
            if (st.has("text")) d += ":" + st.optString("text");
            if (st.optBoolean("coordOnly")) d += "@" + st.optDouble("x") + "," + st.optDouble("y");
            if (k.equals("ai")) d += ":" + st.optString("goal");
            acts.add(d);
            if (k.equals("tap") && st.has("sel") && st.optJSONObject("sel").optString("text").equals("下一页")) {
                if (--pagesLeft <= 0) screen.remove("下一页");
            }
            if (k.equals("tap") && st.has("sel") && st.optJSONObject("sel").optString("text").equals("不存在")) return "找不到按钮";
            return null;
        }
        public String lastSrc() { return "native"; }
        public void settle(long ms) { }
        public void prefetch(JSONObject next) { }
    }

    static JSONObject run(String json, FakeHost h) { return run(json, null, h); }
    static JSONObject run(String json, String vars, FakeHost h) {
        FlowVm vm = new FlowVm(); vm.fast = true;
        return vm.run(new JSONArray(json), vars == null ? null : new JSONObject(vars), h);
    }
    static void check(String name, boolean ok, Object detail) {
        if (ok) { pass++; System.out.println("  ok   " + name); }
        else { failN++; System.out.println("  FAIL " + name + "  -> " + detail); }
    }
    static String q(String s) { return s.replace('\'', '"'); }

    public static void main(String[] a) throws Exception {
        System.out.println("FlowVm 单测");
        FakeHost h;
        JSONObject r;

        h = new FakeHost();
        r = run(q("[{'kind':'tap','sel':{'text':'搜索'}},{'kind':'input','text':'露营'},{'kind':'enter'}]"), h);
        check("线性步骤（旧 Flow 兼容）", r.optBoolean("ok") && h.acts.size() == 3, r);
        check("trace 带每步耗时", r.optJSONArray("trace").length() == 3 && r.optJSONArray("stepMs").length() == 3, r.optJSONArray("trace"));

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'n','value':'5'},{'kind':'if','cond':{'kind':'var','var':'n','op':'>','value':'3'}},{'kind':'tap','sel':{'text':'大'}},{'kind':'else'},{'kind':'tap','sel':{'text':'小'}},{'kind':'endif'},{'kind':'tap','sel':{'text':'后'}}]"), h);
        check("if 为真走 then 跳过 else", r.optBoolean("ok") && h.acts.toString().equals("[tap:大, tap:后]"), h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'n','value':'1'},{'kind':'if','cond':{'kind':'var','var':'n','op':'>','value':'3'}},{'kind':'tap','sel':{'text':'大'}},{'kind':'else'},{'kind':'tap','sel':{'text':'小'}},{'kind':'endif'},{'kind':'tap','sel':{'text':'后'}}]"), h);
        check("if 为假走 else", r.optBoolean("ok") && h.acts.toString().equals("[tap:小, tap:后]"), h.acts);

        h = new FakeHost();
        r = run(q("[{'kind':'if','cond':{'kind':'exists','sel':{'text':'弹窗'}}},{'kind':'tap','sel':{'text':'关闭'}},{'kind':'endif'},{'kind':'tap','sel':{'text':'后'}}]"), h);
        check("if 无 else 为假直接跳过", r.optBoolean("ok") && h.acts.toString().equals("[tap:后]"), h.acts);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'i','value':'0'},{'kind':'while','cond':{'kind':'var','var':'i','op':'<','value':'3'}},{'kind':'tap','sel':{'text':'赞'}},{'kind':'set','var':'i','value':'i + 1'},{'kind':'endwhile'}]"), h);
        check("while 计数 3 次", r.optBoolean("ok") && h.acts.size() == 3, h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'i','value':'10'},{'kind':'do'},{'kind':'tap','sel':{'text':'刷新'}},{'kind':'set','var':'i','value':'i+1'},{'kind':'dowhile','cond':{'kind':'var','var':'i','op':'<','value':'3'}}]"), h);
        check("do-while 条件不成立也执行一次", r.optBoolean("ok") && h.acts.size() == 1, h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'i','value':'0'},{'kind':'do'},{'kind':'tap','sel':{'text':'刷新'}},{'kind':'set','var':'i','value':'i+1'},{'kind':'dowhile','cond':{'kind':'var','var':'i','op':'<','value':'4'}}]"), h);
        check("do-while 执行 4 次", r.optBoolean("ok") && h.acts.size() == 4, h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'for','var':'i','from':1,'to':6},{'kind':'if','cond':{'kind':'var','var':'i','op':'==','value':'3'}},{'kind':'continue'},{'kind':'endif'},{'kind':'if','cond':{'kind':'var','var':'i','op':'==','value':'5'}},{'kind':'break'},{'kind':'endif'},{'kind':'input','text':'第${i}个'},{'kind':'endfor'},{'kind':'tap','sel':{'text':'完'}}]"), h);
        check("for + continue + break + ${i} 插值", r.optBoolean("ok") && h.acts.toString().equals("[input:第1个, input:第2个, input:第4个, tap:完]"), h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'for','var':'i','from':1,'to':30},{'kind':'tap','sel':{'text':'x'}},{'kind':'endfor'}]"), h);
        check("for 1..30 不被默认 20 次上限误伤（v0.16 bug）", r.optBoolean("ok") && h.acts.size() == 30, r.optString("reason"));

        h = new FakeHost();
        r = run(q("[{'kind':'for','var':'i','from':5,'to':1},{'kind':'tap','sel':{'text':'${i}'}},{'kind':'endfor'}]"), h);
        check("for 倒数（自动步长 -1）", r.optBoolean("ok") && h.acts.toString().equals("[tap:5, tap:4, tap:3, tap:2, tap:1]"), h.acts);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'n','value':'3'},{'kind':'for','var':'i','from':1,'to':'${n}'},{'kind':'tap','sel':{'text':'x'}},{'kind':'endfor'}]"), h);
        check("for 的 to 用变量", r.optBoolean("ok") && h.acts.size() == 3, r);

        h = new FakeHost();
        r = run(q("[{'kind':'for','var':'i','from':1,'to':3},{'kind':'for','var':'j','from':1,'to':2},{'kind':'tap','sel':{'text':'${i}-${j}'}},{'kind':'endfor'},{'kind':'endfor'}]"), h);
        check("嵌套 for", r.optBoolean("ok") && h.acts.toString().equals("[tap:1-1, tap:1-2, tap:2-1, tap:2-2, tap:3-1, tap:3-2]"), h.acts);

        h = new FakeHost(); h.screen.add("下一页"); h.pagesLeft = 4;
        r = run(q("[{'kind':'while','cond':{'kind':'exists','sel':{'text':'下一页'}}},{'kind':'tap','sel':{'text':'下一页'}},{'kind':'endwhile'},{'kind':'tap','sel':{'text':'完'}}]"), h);
        check("while exists 翻页到底", r.optBoolean("ok") && h.acts.size() == 5, h.acts + " " + r);

        h = new FakeHost(); h.screen.add("下一页"); h.pagesLeft = 1000;
        r = run(q("[{'kind':'while','cond':{'kind':'exists','sel':{'text':'下一页'}}},{'kind':'tap','sel':{'text':'下一页'}},{'kind':'endwhile'}]"), h);
        check("while 死循环在默认 20 次处失败", !r.optBoolean("ok") && r.optString("reason").contains("循环超过 20") && h.acts.size() == 20, h.acts.size() + " " + r.optString("reason"));

        h = new FakeHost(); h.screen.add("下一页"); h.pagesLeft = 20;
        r = run(q("[{'kind':'while','cond':{'kind':'exists','sel':{'text':'下一页'}}},{'kind':'tap','sel':{'text':'下一页'}},{'kind':'endwhile'}]"), h);
        check("while 恰好 20 次后条件为假不报错", r.optBoolean("ok") && h.acts.size() == 20, h.acts.size() + " " + r.optString("reason"));

        h = new FakeHost();
        r = run(q("[{'kind':'tap','sel':{'text':'不存在'},'optional':true},{'kind':'tap','sel':{'text':'不存在'}},{'kind':'tap','sel':{'text':'后'}}]"), h);
        check("optional 跳过，非 optional 失败并给 failedAt", !r.optBoolean("ok") && r.optInt("failedAt") == 1, r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'p','value':'0.5,0.25'},{'kind':'tap','pointVar':'p'}]"), h);
        check("point 变量点击", r.optBoolean("ok") && h.acts.get(0).equals("tap@0.5,0.25"), h.acts);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'p','value':'0.5,0.25'},{'kind':'set','var':'p.y','value':'p.y + 0.25'},{'kind':'tap','pointVar':'p'}]"), h);
        check("point 字段 p.y 读写", r.optBoolean("ok") && h.acts.get(0).equals("tap@0.5,0.5"), h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'s','value':'{\\'name\\':\\'露营\\',\\'n\\':1}'},{'kind':'set','var':'s.n','value':'s.n * 3'},{'kind':'if','cond':{'kind':'var','var':'s.n','op':'==','value':'3'}},{'kind':'input','text':'${s.name}'},{'kind':'endif'}]"), h);
        check("struct 字段读写 + 条件 + 插值", r.optBoolean("ok") && h.acts.toString().equals("[input:露营]"), h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'tap','sel':{'text':'${who}'}},{'kind':'set','var':'msg','value':'\\'你好，\\' + who'},{'kind':'input','text':'${msg}'}]"), q("{'who':'小明'}"), h);
        check("初始变量 Flow.vars 生效（v0.16 没传给原生）+ 字符串拼接", r.optBoolean("ok") && h.acts.toString().equals("[tap:小明, input:你好，小明]"), h.acts + " " + r);

        // 类：new + 方法（bind/unbind，TS 侧展开后的形状）
        h = new FakeHost();
        r = run(q("[{'kind':'new','var':'c','cls':'Cart','fields':{'count':'0','shop':'美团'},'args':{'shop':'饿了么'}},"
            + "{'kind':'bind','var':'c','cls':'Cart','method':'add','args':{'item':'奶茶'}},{'kind':'input','text':'${this.shop}:${item}'},{'kind':'set','var':'this.count','value':'this.count + 1'},{'kind':'unbind'},"
            + "{'kind':'bind','var':'c','cls':'Cart','method':'add','args':{'item':'面包'}},{'kind':'input','text':'${this.shop}:${item}'},{'kind':'set','var':'this.count','value':'this.count + 1'},{'kind':'unbind'},"
            + "{'kind':'if','cond':{'kind':'var','var':'c.count','op':'==','value':'2'}},{'kind':'tap','sel':{'text':'结算${c.count}'}},{'kind':'endif'},"
            + "{'kind':'set','var':'left','value':'${item}'}]"), h);
        check("class：new 覆盖字段、方法里 this 读写、实参作用域在 unbind 后恢复",
            r.optBoolean("ok") && h.acts.toString().equals("[input:饿了么:奶茶, input:饿了么:面包, tap:结算2]") && r.optJSONObject("vars").optString("left").equals(""),
            h.acts + " " + r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'c','value':'{\\'a\\':1}'},{'kind':'bind','var':'c','cls':'Cart','method':'add'},{'kind':'unbind'}]"), h);
        check("对象类型不对时报错", !r.optBoolean("ok") && r.optString("reason").contains("没有方法"), r.optString("reason"));

        h = new FakeHost();
        r = run(q("[{'kind':'method','var':'c','method':'x'}]"), h);
        check("未展开的 method 报错而不是静默", !r.optBoolean("ok"), r);

        h = new FakeHost();
        r = run(q("[{'kind':'set','var':'x','value':'(2 + 3) * -2'},{'kind':'set','var':'y','value':'3f'},{'kind':'set','var':'z','value':'7 % 0'}]"), h);
        JSONObject v = r.optJSONObject("vars");
        check("四则：括号与负号；'3f' 不被当数字；除零保留文字", v.optDouble("x") == -10 && v.optString("y").equals("3f") && v.optString("z").equals("7 % 0"), v);

        // TS expandCalls 生成的 JSON（端到端：TS 展开 → Java 执行）
        Path p = Path.of(a.length > 0 ? a[0] : "scripts/flowvm-test/expanded.json");
        if (Files.exists(p)) {
            JSONArray cases = new JSONArray(Files.readString(p));
            for (int i = 0; i < cases.length(); i++) {
                JSONObject c = cases.getJSONObject(i);
                h = new FakeHost();
                JSONArray scr = c.optJSONArray("screen");
                if (scr != null) for (int k = 0; k < scr.length(); k++) h.screen.add(scr.getString(k));
                h.pagesLeft = c.optInt("pagesLeft", 0);
                FlowVm vm = new FlowVm(); vm.fast = true;
                r = vm.run(c.getJSONArray("steps"), c.optJSONObject("vars"), h);
                String want = c.getJSONArray("expect").toString();
                String got = new JSONArray(h.acts).toString();
                check("TS→Java " + c.getString("name"), r.optBoolean("ok") == c.optBoolean("ok", true) && want.equals(got), got + " " + r.optString("reason"));
            }
        } else System.out.println("  （没有 expanded.json，跳过 TS→Java 用例；先跑 node scripts/flow-test.mts）");

        System.out.println(pass + " 通过，" + failN + " 失败");
        if (failN > 0) System.exit(1);
    }
}
