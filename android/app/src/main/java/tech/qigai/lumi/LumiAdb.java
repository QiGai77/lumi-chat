package tech.qigai.lumi;

import android.content.Context;
import android.os.Build;

import androidx.annotation.NonNull;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Date;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import io.github.muntashirakon.adb.AbsAdbConnectionManager;
import io.github.muntashirakon.adb.AdbStream;
import sun.security.x509.AlgorithmId;
import sun.security.x509.CertificateAlgorithmId;
import sun.security.x509.CertificateExtensions;
import sun.security.x509.CertificateIssuerName;
import sun.security.x509.CertificateSerialNumber;
import sun.security.x509.CertificateSubjectName;
import sun.security.x509.CertificateValidity;
import sun.security.x509.CertificateVersion;
import sun.security.x509.CertificateX509Key;
import sun.security.x509.KeyIdentifier;
import sun.security.x509.PrivateKeyUsageExtension;
import sun.security.x509.SubjectKeyIdentifierExtension;
import sun.security.x509.X500Name;
import sun.security.x509.X509CertImpl;
import sun.security.x509.X509CertInfo;

/** 自建 ADB：连接本机的无线调试（或 adb tcpip），无需电脑。密钥存在应用私有目录。 */
public class LumiAdb extends AbsAdbConnectionManager {
    private static LumiAdb INSTANCE;
    static final ExecutorService IO = Executors.newCachedThreadPool();
    private final PrivateKey key;
    private final Certificate cert;

    static synchronized LumiAdb get(Context c) throws Exception {
        if (INSTANCE == null) INSTANCE = new LumiAdb(c.getApplicationContext());
        return INSTANCE;
    }

    private LumiAdb(Context c) throws Exception {
        setApi(Build.VERSION.SDK_INT);
        setHostAddress("127.0.0.1");
        File kf = new File(c.getFilesDir(), "adb/adb.key"), cf = new File(c.getFilesDir(), "adb/adb.crt");
        PrivateKey k = null; Certificate ct = null;
        if (kf.exists() && cf.exists()) {
            try {
                k = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(kf.toPath())));
                try (InputStream in = Files.newInputStream(cf.toPath())) { ct = CertificateFactory.getInstance("X.509").generateCertificate(in); }
            } catch (Exception e) { k = null; ct = null; }
        }
        if (k == null || ct == null) {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048, new SecureRandom());
            KeyPair kp = g.generateKeyPair();
            PublicKey pub = kp.getPublic();
            k = kp.getPrivate();
            String alg = "SHA512withRSA";
            Date from = new Date(), to = new Date(System.currentTimeMillis() + 3650L * 86400000L);
            CertificateExtensions ext = new CertificateExtensions();
            ext.set("SubjectKeyIdentifier", new SubjectKeyIdentifierExtension(new KeyIdentifier(pub).getIdentifier()));
            ext.set("PrivateKeyUsage", new PrivateKeyUsageExtension(from, to));
            X500Name name = new X500Name("CN=Lumi Chat");
            X509CertInfo info = new X509CertInfo();
            info.set("version", new CertificateVersion(2));
            info.set("serialNumber", new CertificateSerialNumber(new Random().nextInt() & Integer.MAX_VALUE));
            info.set("algorithmID", new CertificateAlgorithmId(AlgorithmId.get(alg)));
            info.set("subject", new CertificateSubjectName(name));
            info.set("key", new CertificateX509Key(pub));
            info.set("validity", new CertificateValidity(from, to));
            info.set("issuer", new CertificateIssuerName(name));
            info.set("extensions", ext);
            X509CertImpl impl = new X509CertImpl(info);
            impl.sign(k, alg);
            ct = impl;
            //noinspection ResultOfMethodCallIgnored
            kf.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(kf)) { o.write(k.getEncoded()); }
            try (FileOutputStream o = new FileOutputStream(cf)) { o.write(ct.getEncoded()); }
        }
        key = k; cert = ct;
    }

    @NonNull @Override protected PrivateKey getPrivateKey() { return key; }
    @NonNull @Override protected Certificate getCertificate() { return cert; }
    @NonNull @Override protected String getDeviceName() { return "LumiChat"; }

    /** 在 ADB shell 里执行命令，返回输出（最多 64 KB）。 */
    String shell(String cmd, long timeoutMs) throws Exception {
        final AdbStream s = openStream("shell:" + cmd);
        Future<String> f = IO.submit(() -> {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = s.openInputStream()) {
                byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) > 0) { if (out.size() < 65536) out.write(b, 0, Math.min(n, 65536 - out.size())); }
            } catch (Exception ignored) { }
            return out.toString("UTF-8");
        });
        try { return f.get(timeoutMs, TimeUnit.MILLISECONDS); }
        catch (java.util.concurrent.TimeoutException e) { try { s.close(); } catch (Exception ignored) { } return f.isDone() ? f.get() : "（命令超时，已停止）"; }
    }
}
