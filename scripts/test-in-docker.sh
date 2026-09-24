#!/bin/bash
#
# Run the full test suite without installing anything on the host.
#
# Starts a throwaway container for each database engine, builds the test
# image, runs the suite against them, then tears everything down. Your own
# databases are never touched.
#
# Every engine is started by default. Name a subset to save time and memory:
#
#   ENGINES="postgres redis" ./scripts/test-in-docker.sh
#
# Engines not started are skipped by the suite, which says so on stderr.
#
# Usage: ./scripts/test-in-docker.sh [extra args passed to node --test]
set -euo pipefail

ENGINES="${ENGINES:-mysql postgres mssql clickhouse mongodb redis elasticsearch}"
NETWORK="mcp-db-ro-test-net"
PREFIX="mcp-db-ro-test"
TEST_IMAGE="mcp-db-read-only:test"
PASSWORD="test_root_pw"
# SQL Server refuses a password without upper case, lower case and a digit.
MSSQL_PASSWORD="Test_root_pw1"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ENV=()

cleanup() {
  for engine in mysql postgres mssql clickhouse mongodb redis elasticsearch; do
    docker rm -f "$PREFIX-$engine" >/dev/null 2>&1 || true
  done
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wanted() {
  [[ " $ENGINES " == *" $1 "* ]]
}

# Polls a readiness command inside a container, for up to a timeout.
wait_for() {
  local engine="$1" timeout="$2"
  shift 2
  echo "==> waiting for $engine"
  for attempt in $(seq 1 "$timeout"); do
    if docker exec "$PREFIX-$engine" "$@" >/dev/null 2>&1; then
      echo "    ready after ${attempt}s"
      return 0
    fi
    sleep 1
  done
  echo "$engine did not become ready in ${timeout}s" >&2
  docker logs "$PREFIX-$engine" 2>&1 | tail -40 >&2
  exit 1
}

start() {
  local engine="$1"
  shift
  echo "==> starting $engine"
  docker run -d --name "$PREFIX-$engine" --network "$NETWORK" "$@" >/dev/null
}

cleanup
docker network create "$NETWORK" >/dev/null

if wanted mysql; then
  start mysql -e MYSQL_ROOT_PASSWORD="$PASSWORD" -e MARIADB_ROOT_PASSWORD="$PASSWORD" "${MYSQL_IMAGE:-mysql:8.4}"
  TEST_ENV+=(-e "TEST_MYSQL_URL=mysql://root:$PASSWORD@$PREFIX-mysql:3306")
fi
if wanted postgres; then
  start postgres -e POSTGRES_PASSWORD="$PASSWORD" "${POSTGRES_IMAGE:-postgres:16}"
  TEST_ENV+=(-e "TEST_POSTGRES_URL=postgres://postgres:$PASSWORD@$PREFIX-postgres:5432")
fi
if wanted mssql; then
  # Published for amd64 only. On Apple Silicon Docker runs it under emulation,
  # which works but takes a minute or two to start.
  start mssql --platform linux/amd64 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$MSSQL_PASSWORD" \
    "${MSSQL_IMAGE:-mcr.microsoft.com/mssql/server:2022-latest}"
  TEST_ENV+=(-e "TEST_MSSQL_URL=mssql://sa:$MSSQL_PASSWORD@$PREFIX-mssql:1433")
fi
if wanted clickhouse; then
  start clickhouse -e CLICKHOUSE_PASSWORD="$PASSWORD" "${CLICKHOUSE_IMAGE:-clickhouse/clickhouse-server:24.8}"
  TEST_ENV+=(-e "TEST_CLICKHOUSE_URL=clickhouse://default:$PASSWORD@$PREFIX-clickhouse:8123")
fi
if wanted mongodb; then
  start mongodb -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD="$PASSWORD" "${MONGODB_IMAGE:-mongo:7}"
  TEST_ENV+=(-e "TEST_MONGODB_URL=mongodb://root:$PASSWORD@$PREFIX-mongodb:27017")
fi
if wanted redis; then
  start redis "${REDIS_IMAGE:-redis:7-alpine}" redis-server --requirepass "$PASSWORD"
  TEST_ENV+=(-e "TEST_REDIS_URL=redis://:$PASSWORD@$PREFIX-redis:6379")
fi
if wanted elasticsearch; then
  start elasticsearch -e discovery.type=single-node -e xpack.security.enabled=false \
    -e ES_JAVA_OPTS="-Xms512m -Xmx512m" "${ELASTICSEARCH_IMAGE:-elasticsearch:8.15.3}"
  TEST_ENV+=(-e "TEST_ELASTICSEARCH_URL=elasticsearch://$PREFIX-elasticsearch:9200")
fi

# Readiness is checked after every container has been started, so the slow
# ones boot in parallel rather than one after another.
# mysqladmin on MySQL images, mariadb-admin on recent MariaDB ones.
wanted mysql && wait_for mysql 90 sh -c "mysqladmin ping -h 127.0.0.1 -uroot -p$PASSWORD --silent || mariadb-admin ping -h 127.0.0.1 -uroot -p$PASSWORD --silent"
wanted postgres && wait_for postgres 60 pg_isready -U postgres -h 127.0.0.1
wanted mssql && wait_for mssql 240 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_PASSWORD" -C -Q "SELECT 1"
wanted clickhouse && wait_for clickhouse 60 wget -q --spider http://127.0.0.1:8123/ping
wanted mongodb && wait_for mongodb 60 mongosh --quiet -u root -p "$PASSWORD" --eval "db.adminCommand('ping')"
wanted redis && wait_for redis 30 redis-cli -a "$PASSWORD" --no-auth-warning ping
wanted elasticsearch && wait_for elasticsearch 180 curl -fs "http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=1s"

echo "==> building test image"
docker build --target test -t "$TEST_IMAGE" "$REPO_DIR"

echo "==> running tests"
docker run --rm --network "$NETWORK" "${TEST_ENV[@]}" "$TEST_IMAGE" node --test "$@"
