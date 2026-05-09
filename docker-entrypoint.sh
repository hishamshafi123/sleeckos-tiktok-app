#!/bin/sh
set -e
prisma migrate deploy
exec node server.js
