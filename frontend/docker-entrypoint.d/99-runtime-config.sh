#!/bin/sh
set -eu

escape_json() {
    printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

json_string() {
    printf '"%s"' "$(escape_json "$1")"
}

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__GARUPA_RUNTIME_CONFIG__ = {
  API_BASE_DEFAULT: $(json_string "${API_BASE_DEFAULT:-}"),
  DEFAULT_SERVER: $(json_string "${DEFAULT_SERVER:-}"),
  DEFAULT_EVENT: $(json_string "${DEFAULT_EVENT:-}"),
  DEFAULT_SAMPLE_INTERVAL_SECONDS: $(json_string "${DEFAULT_SAMPLE_INTERVAL_SECONDS:-}"),
  DEFAULT_REQUEST_MODE: $(json_string "${DEFAULT_REQUEST_MODE:-}"),
  DEFAULT_REQUEST_INTERVAL_SECONDS: $(json_string "${DEFAULT_REQUEST_INTERVAL_SECONDS:-}"),
  DEFAULT_AUTO_RETRY_DELAY_SECONDS: $(json_string "${DEFAULT_AUTO_RETRY_DELAY_SECONDS:-}"),
  DEFAULT_REQUEST_MINUTE_INTERVAL: $(json_string "${DEFAULT_REQUEST_MINUTE_INTERVAL:-}"),
  DEFAULT_REQUEST_SECOND: $(json_string "${DEFAULT_REQUEST_SECOND:-}"),
  DEFAULT_TIME_MINUTES: $(json_string "${DEFAULT_TIME_MINUTES:-}"),
  DEFAULT_ROWS_PER_PAGE: $(json_string "${DEFAULT_ROWS_PER_PAGE:-}"),
  DEFAULT_PRIMARY_HUE: $(json_string "${DEFAULT_PRIMARY_HUE:-}"),
  DEFAULT_API_MODE: $(json_string "${DEFAULT_API_MODE:-}"),
  DEFAULT_API_BACKEND_BASE_URL: $(json_string "${DEFAULT_API_BACKEND_BASE_URL:-}"),
  BACKEND_API_URL: $(json_string "${BACKEND_API_URL:-http://grp-speed-backend:5519/api}")
};
EOF

