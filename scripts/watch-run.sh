#!/usr/bin/env bash
# 简单盯梢：只观察指定 run，不做任何 dispatch。避免重复触发加剧排队。
# 用法: bash scripts/watch-run.sh <run_id> [out_ipa]
set -u
REPO="${REPO:-gfx136/stockclaw}"
RUN_ID="$1"
OUT_IPA="${2:-/d/ExpoApps/StockClaw-auto.ipa}"
POLL="${POLL:-120}"

TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
api() { curl -s -m 25 --noproxy '*' -H "Authorization: token $TOKEN" "https://api.github.com$1"; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

for i in $(seq 1 40); do
  api "/repos/$REPO/actions/runs/$RUN_ID" -o /tmp/w.json
  read -r status concl < <(python -c "
import json
d=json.load(open(r'C:\\Users\\zhongjw\\AppData\\Local\\Temp\\w.json', encoding='utf-8'))
print(d['status'], d.get('conclusion') or 'null')
")
  log "run $RUN_ID: $status / $concl"

  if [ "$status" = "completed" ]; then
    if [ "$concl" = "success" ]; then
      log "编译成功，下载 artifact…"
      URL=$(api "/repos/$REPO/actions/runs/$RUN_ID/artifacts" | python -c "
import sys, json
try:
    a=json.load(sys.stdin)['artifacts']
    print(a[0]['archive_download_url'] if a else '')
except Exception: print('')
")
      if [ -n "$URL" ]; then
        T=$(mktemp -d)
        curl -s -L -m 200 --noproxy '*' -H "Authorization: token $TOKEN" "$URL" -o "$T/a.zip" \
          && (cd "$T" && unzip -oq a.zip) \
          && mv -f "$(find "$T" -name '*.ipa' | head -n1)" "$OUT_IPA" \
          && log "✅ 已保存: $OUT_IPA" && rm -rf "$T" && exit 0
      fi
      log "artifact 下载失败"
      exit 1
    fi
    log "run 结束但结果=$concl"
    STEPS=$(api "/repos/$REPO/actions/runs/$RUN_ID/jobs" | python -c "
import sys, json
try: print(len(json.load(sys.stdin)['jobs'][0].get('steps',[])))
except Exception: print(-1)
")
    log "  步骤数=$STEPS（0=排队被回收，非编译错误）"
    exit 2
  fi
  sleep "$POLL"
done
log "❌ 观察超时"
exit 3