#!/usr/bin/env bash
curl -fsS "http://127.0.0.1:${HAB_PORT:-7931}/api/health";echo
