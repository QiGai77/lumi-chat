package tech.qigai.lumi;

import android.graphics.Bitmap;
import android.graphics.Rect;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.util.concurrent.TimeUnit;

/**
 * v0.23 端侧 OCR：ML Kit Text Recognition v2 中文模型（bundled，打包进 APK，不需要 Google Play 服务）。
 * Flow 里原生查找失败、准备走 AI 视觉之前先用它在截图上找目标文字，找到就点文字框，省掉一次约 2 秒的模型往返。
 * 只在后台线程调用（Tasks.await 不能在主线程）。识别前把截图长边缩到 1600px 以内以控制耗时，返回的框换算回屏幕坐标。
 */
final class LumiOcr {
    private static TextRecognizer rec;
    private static volatile boolean broken = false;
    private static final int MAX_EDGE = 1600;

    private LumiOcr() { }

    private static synchronized TextRecognizer rec() {
        if (rec == null) rec = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        return rec;
    }

    /** 加载模型（第一次识别要几百毫秒）：用一张小白图跑一次。失败就标记不可用，之后不再尝试。 */
    static void warm() {
        if (broken) return;
        try {
            Bitmap b = Bitmap.createBitmap(64, 32, Bitmap.Config.ARGB_8888);
            b.eraseColor(0xFFFFFFFF);
            Tasks.await(rec().process(InputImage.fromBitmap(b, 0)), 4, TimeUnit.SECONDS);
            b.recycle();
        } catch (Throwable e) { if (e instanceof LinkageError) broken = true; }
    }

    private static String norm(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) continue;
            if (c >= 0xFF01 && c <= 0xFF5E) c = (char) (c - 0xFEE0); // 全角 → 半角
            b.append(Character.toLowerCase(c));
        }
        return b.toString();
    }

    /**
     * 在 shot（屏幕像素坐标的截图）里找文字 target，返回屏幕坐标的框；找不到返回 null。
     * 优先：整行相等 > 元素相等 > 行内包含（按字符位置在行框里按比例切出子框）。同等级取最短的行（最不含杂字）。
     */
    static Rect find(Bitmap shot, String target, long timeoutMs) throws Exception {
        if (broken || shot == null || target == null || target.trim().isEmpty()) return null;
        String want = norm(target);
        int w = shot.getWidth(), h = shot.getHeight();
        float k = Math.min(1f, (float) MAX_EDGE / Math.max(w, h));
        Bitmap in = k < 1f ? Bitmap.createScaledBitmap(shot, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true) : shot;
        Text text;
        try {
            text = Tasks.await(rec().process(InputImage.fromBitmap(in, 0)), timeoutMs, TimeUnit.MILLISECONDS);
        } catch (LinkageError e) { broken = true; return null; }
        finally { if (in != shot) in.recycle(); }
        Rect best = null; int bestRank = 0; int bestLen = Integer.MAX_VALUE;
        for (Text.TextBlock blk : text.getTextBlocks()) {
            for (Text.Line ln : blk.getLines()) {
                Rect lb = ln.getBoundingBox();
                if (lb == null) continue;
                String lt = norm(ln.getText());
                int rank = 0; Rect box = null;
                if (lt.equals(want)) { rank = 3; box = lb; }
                else {
                    for (Text.Element el : ln.getElements()) {
                        Rect eb = el.getBoundingBox();
                        if (eb != null && norm(el.getText()).equals(want)) { rank = 2; box = eb; break; }
                    }
                    if (box == null) {
                        int at = lt.indexOf(want);
                        if (at >= 0 && lt.length() > 0) {
                            rank = 1;
                            float a = (float) at / lt.length(), z = (float) (at + want.length()) / lt.length();
                            box = new Rect(lb.left + Math.round(lb.width() * a), lb.top, lb.left + Math.round(lb.width() * z), lb.bottom);
                        }
                    }
                }
                if (box == null) continue;
                if (rank > bestRank || (rank == bestRank && lt.length() < bestLen)) { bestRank = rank; bestLen = lt.length(); best = box; }
            }
        }
        if (best == null) return null;
        if (k < 1f) best = new Rect(Math.round(best.left / k), Math.round(best.top / k), Math.round(best.right / k), Math.round(best.bottom / k));
        return best;
    }
}
