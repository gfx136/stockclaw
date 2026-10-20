#!/usr/bin/env bash
# 盯梢指定 run，编译成功后自动下载 IPA。不做任何 dispatch（不加剧排队）。
# 用法: bash scripts/watch-run.sh <run_id> [out_ipa]
set -u
REPO="${REPO:-gfx136/stockclaw}"
RUN_ID="${1:?用法: watch-run.sh <run_id> [out_ipa]}"
OUT_IPA="${2:-/d/ExpoApps/StockClaw-auto.ipa}"
POLL="${POLL:-120}"
MAX_CHECKS="${MAX_CHECKS:-60}"

TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
TMP="${TMPDIR:-/tmp}"
WF="$TMP/w_run.json"

api_get() { curl -s -m 30 --noproxy '*' -H "Authorization: token $TOKEN" "https://api.github.com$1"; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

for i in $(seq 1 "$MAX_CHECKS"); do
  api_get "/repos/$REPO/actions/runs/$RUN_ID" > "$WF"
  read -r status concl < <(python -c "
import json
try:
    d=json.load(open(r'$WF', encoding='utf-8'))
    print(d.get('status','none'), d.get('conclusion') or 'null')
except Exception:
    print('none null')
")
  log "run $RUN_ID: $status / $concl"

  if [ "$status" = "completed" ]; then
    if [ "$concl" = "success" ]; then
      log "编译成功，下载 artifact…"
      URL=$(api_get "/repos/$REPO/actions/runs/$RUN_ID/artifacts" | python -c "
import sys, json
try:
    a=json.load(sys.stdin)['artifacts']
    print(a[0]['archive_download_url'] if a else '')
except Exception: print('')
")
      if [ -n "$URL" ]; then
        D=$(mktemp -d)
        if curl -s -L -m 250 --noproxy '*' -H "Authorization: token $TOKEN" "$URL" -o "$D/a.zip"; then
          (cd "$D" && unzip -oq a.zip)
          IPA=$(find "$D" -name '*.ipa' | head -n1)
          if [ -n "$IPA" ]; then
            mv -f "$IPA" "$OUT_IPA"
            log "✅ 已保存: $OUT_IPA"
            rm -rf "$D"
            exit 0
          fi
        fi
        log "artifact 下载/解压失败"
        rm -rf "$D"
      else
        log "未找到 artifact"
      fi
      exit 1
    fi
    STEPS=$(api_get "/repos/$REPO/actions/runs/$RUN_ID/jobs" | python -c "
import sys, json
try: print(len(json.load(sys.stdin)['jobs'][0].get('steps',[])))
except Exception: print(-1)
")
    log "run 结束，结果=$concl，步骤数=$STEPS"
    if [ "$STEPS" = "0" ]; then
      log "  → 步骤数 0 = 排队被回收（非编译错误）"
    else
      log "  → 已执行 $STEPS 步，可能是真编译失败，请看 GitHub 页面"
    fi
    exit 2
  fi
  sleep "$POLL"
done
log "❌ 观察超时（$MAX_CHECKS 次）"
exit 3