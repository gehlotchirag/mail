#!/bin/bash
# Create PostgreSQL database and user for Flux mail server
# Run as: sudo -u postgres bash setup_postgres.sh
set -e

DB_NAME="flux_mail"
DB_USER="flux_mail"
DB_PASS="${FLUX_DB_PASSWORD:-changeme}"

psql -U postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
  END IF;
END
\$\$;

DROP DATABASE IF EXISTS $DB_NAME;
CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL

psql -U postgres -d $DB_NAME <<SQL
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
SQL

echo "Database '$DB_NAME' created with user '$DB_USER'"
PGPASSWORD="$DB_PASS" psql -U $DB_USER -h 127.0.0.1 -d $DB_NAME -c "SELECT 'Connection OK';"
