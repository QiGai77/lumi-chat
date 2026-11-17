#!/usr/bin/env bash
# FlowVm 在普通 JVM 上的单测。需要 JDK 17+。先跑 `node scripts/flow-test.mts` 生成 expanded.json（TS 展开 → Java 执行）。
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
JSON_JAR=${JSON_JAR:-/tmp/json-20240303.jar}
[ -f "$JSON_JAR" ] || curl -sfL -o "$JSON_JAR" https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar
javac -nowarn -d "$OUT" -cp "$JSON_JAR" android/app/src/main/java/tech/qigai/lumi/FlowVm.java scripts/flowvm-test/FlowVmTest.java
java -cp "$OUT:$JSON_JAR" FlowVmTest scripts/flowvm-test/expanded.json
