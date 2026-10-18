#!/usr/bin/env bash
# Uptime probe for wargrobotics.com.
#
# Checks each public hostname, and then each IP the apex resolves to, one at a
# time. A normal monitor resolves the name once and hits whichever address it
# gets, so a single dead edge IP shows up as "flaky" rather than as a fault.
# Probing every address separately says exactly which one is down.
#
# Output: one line per probe to stdout, a Markdown table to $GITHUB_STEP_SUMMARY
# (when set), and exit code 1 if any probe failed. Failed probe lines are also
# written to $FAIL_FILE (default: failures.txt) for the workflow to report.

set -u

HOSTS=(
  "wargrobotics.com"
  "www.wargrobotics.com"
  "wargrobotics-website.vercel.app"
)
APEX="wargrobotics.com"
PATH_TO_CHECK="/"
TIMEOUT=15          # seconds per request
SLOW_MS=4000        # flag responses slower than this
FAIL_FILE="${FAIL_FILE:-failures.txt}"

: > "$FAIL_FILE"
rows=()
failed=0

probe() {  # probe <label> <url> [curl args...]
  local label="$1" url="$2"; shift 2
  local out err code ms errf
  errf=$(mktemp)
  out=$(curl -sS -o /dev/null -L --max-redirs 3 --max-time "$TIMEOUT" \
        -w '%{http_code} %{time_total}' "$@" "$url" 2>"$errf")
  err=$(tr '\n' ' ' < "$errf"); rm -f "$errf"
  err="${err#curl: }"
  code="${out%% *}"
  if [[ "$code" =~ ^[0-9]{3}$ && "$code" != "000" ]]; then
    ms=$(awk -v t="${out#* }" 'BEGIN{printf "%d", t*1000}')
  else
    code="ERR"; ms="-"
  fi

  local status="up"
  if [[ "$code" == "ERR" || "$code" -ge 400 ]]; then
    status="DOWN"; failed=1
    echo "$label -> $code ${err}" >> "$FAIL_FILE"
  elif [[ "$ms" != "-" && "$ms" -gt "$SLOW_MS" ]]; then
    status="slow"
  fi

  printf '%-48s %-5s %6s ms  %s\n' "$label" "$code" "$ms" "$status"
  rows+=("| $label | $code | $ms | $status |")
}

for h in "${HOSTS[@]}"; do
  probe "https://$h" "https://$h$PATH_TO_CHECK"
done

# Every address the apex currently resolves to, pinned with --resolve so TLS
# and Host headers still match the real domain.
if command -v dig >/dev/null; then
  mapfile -t ips < <(dig +short A "$APEX" | grep -E '^[0-9.]+$' | sort -u)
else
  mapfile -t ips < <(getent ahostsv4 "$APEX" | awk '{print $1}' | sort -u)
fi
if [[ ${#ips[@]} -eq 0 ]]; then
  echo "DNS: no A records for $APEX" | tee -a "$FAIL_FILE"
  rows+=("| DNS A $APEX | none | - | DOWN |")
  failed=1
fi
for ip in "${ips[@]}"; do
  probe "https://$APEX via $ip" "https://$APEX$PATH_TO_CHECK" --resolve "$APEX:443:$ip"
done

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Uptime check $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo
    echo "| Probe | HTTP | Time (ms) | Status |"
    echo "|---|---|---|---|"
    printf '%s\n' "${rows[@]}"
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit $failed
