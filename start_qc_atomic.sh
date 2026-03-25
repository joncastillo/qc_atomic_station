#!/bin/bash

SSH_DIR=/opt/qc_atomic_station/.ssh
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
if [ ! -f "$SSH_DIR/id_ed25519" ]; then
  ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N ""
  echo "SSH key generated at $SSH_DIR/id_ed25519"
fi

docker run -d \
  --name qc_atomic_station \
  --network=host \
  -e QC_ATOMIC_STATION_TOKEN="${QC_ATOMIC_STATION_TOKEN}" \
  -v /opt/qc_atomic_station:/app \
  -v /opt/qc_atomic_station/.ssh:/root/.ssh:ro \
  -w /app \
  node:20 \
  bash -c "apt-get update -q && apt-get install -y -q python3 python3-pip && \
    npm ci && npm run build && \
    pip3 install --break-system-packages -r requirements.txt && \
    python3 src/backend/main.py"
