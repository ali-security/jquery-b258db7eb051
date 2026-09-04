#!/bin/bash
#
# Run the QUnit suite headlessly, one module per PhantomJS process.
#
# jQuery 1.11 had no CI test runner: upstream drove test/index.html through
# TestSwarm, so .travis.yml only ever ran grunt's lint/build pipeline. This
# script runs the real suite instead. It is split per module because PhantomJS
# 2.1 cannot hold the whole suite in one process, and the ajax module segfaults
# it outright every other run — a crash (no QUnit result at all) is retried,
# while a module that reports failing tests fails the build immediately.
set -u

PHANTOM=${PHANTOMJS_BIN:-phantomjs}
PHP=${PHP_BIN:-php}
PORT=${QUNIT_PORT:-8123}
ATTEMPTS=${QUNIT_ATTEMPTS:-8}
PHANTOM_OPTS=${PHANTOM_OPTS:-}
ROOT=$( cd "$( dirname "$0" )/.." && pwd )

MODULES="ajax attributes callbacks core css data deferred dimensions effects
event manipulation offset queue selector serialize support traversing"

cd "$ROOT"

# PHP's built-in server is single-threaded, and a PhantomJS crash can leave a
# request in flight that wedges it for every later module. Give each attempt a
# fresh server instead of raising PHP_CLI_SERVER_WORKERS: concurrent workers
# make the ajax module crash PhantomJS every single time.
PHP_PID=""
start_server() {
	"$PHP" -S 127.0.0.1:"$PORT" -t . > /tmp/qunit-php-server.log 2>&1 &
	PHP_PID=$!
	sleep 2
}
stop_server() {
	if [ -n "$PHP_PID" ]; then
		kill "$PHP_PID" 2>/dev/null
		wait "$PHP_PID" 2>/dev/null
		PHP_PID=""
	fi
}
trap stop_server EXIT

failed=""
for module in $MODULES; do
	echo "=============== module: $module ==============="
	url="http://127.0.0.1:$PORT/test/index.html?module=$module"
	attempt=1
	while [ "$attempt" -le "$ATTEMPTS" ]; do
		start_server
		# tee so Travis sees the runner heartbeat live and never trips its
		# no-output timeout.
		"$PHANTOM" $PHANTOM_OPTS test/phantom-runner.js "$url" 2>&1 | tee /tmp/qunit-module.out
		rc=${PIPESTATUS[0]}
		out=$( cat /tmp/qunit-module.out )
		stop_server
		if [ "$rc" -eq 0 ]; then
			break
		fi
		if echo "$out" | grep -q "^QUnit result:"; then
			# QUnit reported: these are real test failures, not a browser crash.
			failed="$failed $module"
			break
		fi
		echo ">>> $module: browser died without reporting (attempt $attempt/$ATTEMPTS)"
		attempt=$(( attempt + 1 ))
		if [ "$attempt" -gt "$ATTEMPTS" ]; then
			failed="$failed $module"
		fi
	done
done

echo "==============================================="
if [ -n "$failed" ]; then
	echo "QUnit modules failed:$failed"
	exit 1
fi
echo "QUnit: all modules passed."
