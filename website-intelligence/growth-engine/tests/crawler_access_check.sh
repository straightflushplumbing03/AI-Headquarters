#!/usr/bin/env bash
# Crawler accessibility check for https://straightflushplumbingoc.com
# Exit 0 if crawlers reach the site (200, no cf-mitigated), else exit 1.
# Used by Automation B (Daily Technical Health Check).
set -u
DOMAIN="${1:-https://straightflushplumbingoc.com}"
FAIL=0

check() {
  local ua="$1" path="$2" label="$3"
  local out code mit
  out=$(curl -sI -m 20 -A "$ua" "$DOMAIN$path" 2>/dev/null)
  code=$(printf '%s' "$out" | head -1 | awk '{print $2}')
  mit=$(printf '%s' "$out" | grep -i '^cf-mitigated:' | tr -d '\r')
  printf '  [%s] %s %s %s\n' "${code:-ERR}" "$label" "$path" "${mit:+($mit)}"
  [ "$code" = "200" ] || FAIL=1
  [ -z "$mit" ] || FAIL=1
}

echo "=== Crawler accessibility: $DOMAIN ($(date -u +%FT%TZ)) ==="
check "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "/" "Googlebot"
check "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" "/" "Bingbot"
check "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)" "/" "GPTBot"
check "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)" "/" "OAI-SearchBot"
check "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" "/" "ClaudeBot"
check "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" "/" "PerplexityBot"
check "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)" "/" "Applebot"
check "curl/8" "/robots.txt" "curl"
check "curl/8" "/sitemap.xml" "curl"
check "curl/8" "/llms.txt" "curl"

if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: OK — crawlers can reach the site."
  exit 0
else
  echo "RESULT: FAIL — one or more checks returned non-200 or cf-mitigated. See growth-engine/KNOWN_ISSUES.md ISSUE-001."
  exit 1
fi
