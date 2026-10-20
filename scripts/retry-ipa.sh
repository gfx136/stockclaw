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
# ⚠️ 关于 QUEUE_LIMIT_MIN（2026-10-21 修正认知）：
#   GitHub 的 runner 队列是 FIFO 的 —— 主动取消再重新触发，等于把自己排到队尾，
#   在高峰期只会越排越后，是**反效果**。实测系统自己的回收时机在排队 **16~17 分钟**
#   （run 39458431610：16:33:05 创建 → 16:49:50 被判 failure，步骤数 0）。
#   所以阈值设到 17 分钟：在这之前绝不主动轮换，让系统自己决定；
#   被回收后再重新触发（此时本来也是队尾，没有损失）。
QUEUE_LIMIT_MIN="${QUEUE_LIMIT_MIN:-17}"  # 排队超过该分钟数才考虑主动轮换

# 只认「本次提交」的 run。默认取仓库当前 HEAD；给自动化任务用时可显式传。
TARGET_SHA="${TARGET_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}"
export TARGET_SHA

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

api_post() { # api_post <path> [body]  —— 返回 body，HTTP 码写到 $HTTP_CODE 文件
  curl -s -m 25 --noproxy '*' -X POST \
    -w '\n%{http_code}' \
    -H "Authorization: token $(get_token)" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com$1" -d "${2:-{\}}" >/tmp/.rb_body.$$ 2>/dev/null
  HTTP_CODE=$(tail -n1 /tmp/.rb_body.$$ 2>/dev/null)
  sed '$d' /tmp/.rb_body.$$ 2>/dev/null
  rm -f /tmp/.rb_body.$$
}

# 取当前最大的 run id（run id 单调递增，可用作"是否出现新 run"的判据）
max_run_id() {
  api "/repos/$REPO/actions/runs?per_page=20" | python -c "
import sys, json
try:
    ids = [r['id'] for r in json.load(sys.stdin)['workflow_runs']]
    print(max(ids) if ids else 0)
except Exception:
    print(0)
" | tr -d '\r'
}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# 取"当前该盯的 run"，输出: id status conclusion created_at
# ⚠️ 坑3：不能只看 per_page=1 的最新一条。实测会出现「新 run 已触发、但更早的一条
#    还在 queued」并发两条排队的情况；只看最新一条就会以为没活跃 run 而再 dispatch 一次。
#    所以：只要列表里还有活跃 run，就优先盯它（取 id 最大的那条）。
# ⚠️ 坑4（严重）：**必须先按 commit 过滤**。否则上一版代码的成功 run 会被当成本次成果，
#    直接把旧包下载下来当新包交付（实际踩过：v10 拿到了上一个 commit 的 ipa）。
#    没有 head_sha 匹配的 run 时返回 status=no_run，由 main 触发一次新的。
pick_run() {
  api "/repos/$REPO/actions/runs?per_page=30" | python -c "
import sys, json, os
ACT = ('queued', 'in_progress', 'requested', 'waiting')
target = os.environ.get('TARGET_SHA', '')
try:
    runs = json.load(sys.stdin)['workflow_runs']
except Exception:
    print('0 api_error null 0'); raise SystemExit
if target:
    runs = [r for r in runs if (r.get('head_sha') or '') == target]
if not runs:
    print('0 no_run null 0'); raise SystemExit
act = [r for r in runs if r['status'] in ACT]
r = max(act, key=lambda x: x['id']) if act else runs[0]
print(r['id'], r['status'], r.get('conclusion') or 'null', r['created_at'])
" | tr -d '\r'
}

# 只保留一个活跃 run，其余全部取消（避免多条并发排队互相占位、也避免重复 dispatch）
cancel_other_active() {
  local keep="$1" ids
  ids=$(api "/repos/$REPO/actions/runs?per_page=20" | python -c "
import sys, json
ACT = ('queued', 'in_progress', 'requested', 'waiting')
try:
    for r in json.load(sys.stdin)['workflow_runs']:
        if r['status'] in ACT and str(r['id']) != '$keep':
            print(r['id'])
except Exception:
    pass
" | tr -d '\r')
  for id in $ids; do
    api_post "/repos/$REPO/actions/runs/$id/cancel" >/dev/null
    log "已取消多余活跃 run $id（保留 $keep）"
  done
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
" | tr -d '\r'
}

dispatch() {
  # 注意：不能写成 out=$(api_post ...) —— 子 shell 里设置的 HTTP_CODE 传不回来
  api_post "/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" '{"ref":"main"}' >/dev/null
  if [ "$HTTP_CODE" != "204" ]; then
    log "⚠️ dispatch 失败 HTTP=$HTTP_CODE"
    return 1
  fi
  return 0
}

# 触发后等待新 run 出现。
# ⚠️ 坑1：dispatch 返回 204 后新 run 要 1~3 分钟才进列表（GitHub 侧异步创建）。
# ⚠️ 坑2（旧版重大 bug）：以前用"任一 id != before_id"判断新 run，
#    但列表按 created_at 倒序，第二条就是**更早的旧 run**，
#    于是立刻误判"新 run 已创建"并拿去用 —— 实际既没等待、也可能重复触发。
#    现在改为：记录 dispatch 前的最大 run id，只有出现 **更大的 id** 才算成功。
DISPATCH_WAIT_SEC="${DISPATCH_WAIT_SEC:-180}"
NEW_RUN_ID=""
dispatch_and_wait() {
  local before_max waited=0 rid
  before_max=$(max_run_id)
  log "dispatch 前最大 run id = $before_max"
  dispatch || return 1
  while [ "$waited" -lt "$DISPATCH_WAIT_SEC" ]; do
    sleep 10
    waited=$((waited + 10))
    rid=$(api "/repos/$REPO/actions/runs?per_page=10" | python -c "
import sys, json
try:
    ids = [r['id'] for r in json.load(sys.stdin)['workflow_runs']]
    new = [i for i in ids if i > $before_max]
    print(max(new) if new else 0)
except Exception:
    print(0)
" | tr -d '\r')
    if [ -n "$rid" ] && [ "$rid" != "0" ]; then
      log "新 run 已创建: $rid（等待 ${waited}s）"
      NEW_RUN_ID="$rid"
      return 0
    fi
  done
  log "⚠️ 等待 ${DISPATCH_WAIT_SEC}s 仍未看到新 run（run id 未超过 $before_max）"
  return 1
}

# 取消所有活跃 run（清理战场，避免旧 run 占排队位）
cancel_active() {
  local ids
  ids=$(api "/repos/$REPO/actions/runs?per_page=10" | python -c "
import sys, json
try:
    for r in json.load(sys.stdin)['workflow_runs']:
        if r['status'] in ('queued', 'in_progress', 'requested', 'waiting'):
            print(r['id'])
except Exception:
    pass
" | tr -d '\r')
  for id in $ids; do
    api_post "/repos/$REPO/actions/runs/$id/cancel" >/dev/null
    log "已取消活跃 run $id"
  done
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
" | tr -d '\r')
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

    read -r rid status concl created <<<"$(pick_run | tr -d '\r')"
    if [ "$rid" = "0" ]; then
      if [ "$status" = "no_run" ]; then
        # 当前提交还没有任何 run（刚 push 完最常见）→ 直接触发一次
        log "提交 ${TARGET_SHA:0:7} 还没有对应的 run，触发一次"
        if ! dispatch_and_wait; then
          log "本轮触发未生效，${POLL_SEC}s 后重试"
          sleep "$POLL_SEC"
        fi
      else
        log "读取 run 列表失败（网络？），稍后重试"
        sleep "$POLL_SEC"
      fi
      continue
    fi

    # 有活跃 run 时，先清掉并发的多余排队 run，只留一个（否则互相占位、还容易被误判）
    if [ "$status" = "queued" ] || [ "$status" = "in_progress" ]; then
      cancel_other_active "$rid"
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
" | tr -d '\r')
      # 一旦开始真正执行（in_progress），耐心等编译完成
      if [ "$status" = "in_progress" ]; then
        log "run $rid 已开始编译，等待完成…"
        sleep "$POLL_SEC"
        continue
      fi
      # queued 且超过阈值 → 取消并重新触发（快速轮换，撞空闲窗口）
      if [ "$age_min" -ge "$QUEUE_LIMIT_MIN" ]; then
        log "已排队 ${age_min} 分钟（超过 ${QUEUE_LIMIT_MIN} 分钟），取消并重新触发以撞空闲窗口"
        api_post "/repos/$REPO/actions/runs/$rid/cancel" >/dev/null
        sleep 10
        cancel_active       # 顺手清掉其它残留排队 run，避免占位
        sleep 3
        if ! dispatch_and_wait; then
          log "本轮触发未生效，${POLL_SEC}s 后重试"
          sleep "$POLL_SEC"
        fi
      else
        log "run $rid 排队中（${age_min} 分钟），继续等待…"
        sleep "$POLL_SEC"
      fi
      continue
    fi

    # 已完成但非成功 → 判断是否"从未执行"（被回收的伪失败）
    steps=$(job_steps "$rid")
    if [ "$steps" = "0" ]; then
      log "run $rid 结论=$concl 但步骤数=0 → 排队被回收（非编译错误），重新触发"
      if ! dispatch_and_wait; then
        # 不要空转把轮数烧光：dispatch 没成功就隔一个轮询间隔再来
        log "本轮触发未生效，${POLL_SEC}s 后重试"
        sleep "$POLL_SEC"
      else
        sleep "$POLL_SEC"   # 给新 run 一点时间，避免下一轮立刻又看到旧结论
      fi
    else
      log "⚠️ run $rid 结论=$concl 且跑了 $steps 个步骤 → 可能是真的编译失败，请查看日志"
      log "   链接: https://github.com/$REPO/actions/runs/$rid"
      sleep 10
    fi
  done

  log "❌ 已达最大轮数仍未成功，请手动检查"
  return 1
}

# 允许被 source 进来做单函数测试（直接执行时才跑 main）
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi