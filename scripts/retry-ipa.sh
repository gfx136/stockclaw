#!/usr/bin/env bash
#
# 自动重试 GitHub Actions 打包，直到编译成功并下载 IPA。
#
# 背景：GitHub 免费账号用共享 macOS runner 池，高峰期排队可能超过 15 分钟，
#       此时 job 会被系统回收——表现为 run 结论 failure/cancelled 但 **job 步骤数为 0**
#       （不是编译错误，代码本身没问题）。本脚本检测到这种"伪失败"就自动重新触发。
#
# 用法：
#   bash scripts/retry-ipa.sh                # 默认输出 /d/ExpoApps/StockClaw-auto.ipa
#   OUT_IPA=/d/ExpoApps/StockClaw-v9.ipa bash scripts/retry-ipa.sh
#
# 退出码：0 = 成功下载；1 = 超过最大轮数仍未成功

set -u

REPO="${REPO:-gfx136/stockclaw}"
WORKFLOW="${WORKFLOW:-build-ipa.yml}"
OUT_IPA="${OUT_IPA:-/d/ExpoApps/StockClaw-auto.ipa}"
MAX_ROUNDS="${MAX_ROUNDS:-20}"      # 最多重试轮数
POLL_SEC="${POLL_SEC:-150}"         # 每轮轮询间隔（秒）
QUEUE_LIMIT_MIN="${QUEUE_LIMIT_MIN:-14}"  # 排队超过该分钟数即认为拥堵，主动取消重试

TOKEN=""
get_token() {
  if [ -z "$TOKEN" ]; then
    TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null \
      | grep '^password=' | cut -d= -f2)
  fi
  printf '%s' "$TOKEN"
}

api() { # api <path>  —— 只读 GET
  curl -s -m 25 --noproxy '*' -H "Authorization: token $(get_token)" \
    "https://api.github.com$1"
}

api_post() { # api_post <path> [body]
  curl -s -m 25 --noproxy '*' -X POST \
    -H "Authorization: token $(get_token)" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com$1" -d "${2:-{}}"
}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# 取最近一次 run 的 id / status / conclusion
latest_run() {
  api "/repos/$REPO/actions/runs?per_page=1" | python -c "
import sys, json
try:
    r = json.load(sys.stdin)['workflow_runs'][0]
    print(r['id'], r['status'], r.get('conclusion') or 'null', r['created_at'])
except Exception:
    print('0 none null 0')
"
}

# 取某 run 的 job 步骤数（判断是否"从未执行"）
job_steps() {
  api "/repos/$REPO/actions/runs/$1/jobs" | python -c "
import sys, json
try:
    jobs = json.load(sys.stdin)['jobs']
    print(len(jobs[0].get('steps', [])) if jobs else 0)
except Exception:
    print(-1)
"
}

dispatch() {
  api_post "/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" '{"ref":"main"}' >/dev/null
}

download_ipa() { # download_ipa <run_id>
  local rid="$1" url tmp
  url=$(api "/repos/$REPO/actions/runs/$rid/artifacts" | python -c "
import sys, json
try:
    a = json.load(sys.stdin)['artifacts']
    print(a[0]['archive_download_url'] if a else '')
except Exception:
    print('')
")
  if [ -z "$url" ]; then
    log "未找到 artifact"
    return 1
  fi
  tmp=$(mktemp -d)
  log "下载 artifact…"
  curl -s -L -m 200 --noproxy '*' -H "Authorization: token $(get_token)" "$url" -o "$tmp/a.zip" || return 1
  ( cd "$tmp" && unzip -oq a.zip ) || return 1
  local ipa
  ipa=$(find "$tmp" -name '*.ipa' | head -n1)
  if [ -z "$ipa" ]; then
    log "压缩包内未找到 .ipa"
    return 1
  fi
  mv -f "$ipa" "$OUT_IPA"
  rm -rf "$tmp"
  log "已保存: $OUT_IPA"
  return 0
}

main() {
  local round rid status concl created steps age_min

  for round in $(seq 1 "$MAX_ROUNDS"); do
    log "── 第 $round/$MAX_ROUNDS 轮 ──"

    read -r rid status concl created <<<"$(latest_run)"
    if [ "$rid" = "0" ]; then
      log "读取 run 列表失败（网络？），稍后重试"
      sleep "$POLL_SEC"; continue
    fi

    # 已成功 → 下载交付
    if [ "$status" = "completed" ] && [ "$concl" = "success" ]; then
      log "编译成功 (run $rid)，开始下载"
      if download_ipa "$rid"; then
        log "✅ 完成"
        return 0
      fi
      log "下载失败，稍后重试"; sleep "$POLL_SEC"; continue
    fi

    # 仍在进行 → 看排队是否过久
    if [ "$status" = "in_progress" ] || [ "$status" = "queued" ]; then
      age_min=$(python -c "
from datetime import datetime, timezone
c = datetime.fromisoformat('$created'.replace('Z','+00:00'))
print(int((datetime.now(timezone.utc) - c).total_seconds() / 60))
")
      if [ "$status" = "queued" ] && [ "$age_min" -ge "$QUEUE_LIMIT_MIN" ]; then
        log "已排队 ${age_min} 分钟（超过 ${QUEUE_LIMIT_MIN} 分钟），取消并重新触发"
        api_post "/repos/$REPO/actions/runs/$rid/cancel" >/dev/null
        sleep 8
        dispatch; sleep 15
      else
        log "run $rid 状态=$status（排队 ${age_min} 分钟），继续等待…"
        sleep "$POLL_SEC"
      fi
      continue
    fi

    # 已完成但非成功 → 判断是否"从未执行"（被回收的伪失败）
    steps=$(job_steps "$rid")
    if [ "$steps" = "0" ]; then
      log "run $rid 结论=$concl 但步骤数=0 → 排队被回收（非编译错误），重新触发"
    else
      log "⚠️ run $rid 结论=$concl 且跑了 $steps 个步骤 → 可能是真的编译失败，请查看日志"
      log "   链接: https://github.com/$REPO/actions/runs/$rid"
      sleep 5
    fi
    dispatch; sleep 15
  done

  log "❌ 已达最大轮数仍未成功，请手动检查"
  return 1
}

main "$@"