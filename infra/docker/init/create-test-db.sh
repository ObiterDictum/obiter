#!/bin/sh
# Creates the test database alongside the default `ormont` database.
# Runs only on a fresh (empty) data volume.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE ormont_test;
  GRANT ALL PRIVILEGES ON DATABASE ormont_test TO $POSTGRES_USER;
EOSQL
