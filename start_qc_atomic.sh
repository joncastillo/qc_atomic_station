  #!/bin/bash

  # Generate SSH key for credential encryption (persisted on host)
  SSH_DIR=/opt/qc_atomic_station/.ssh
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  if [ ! -f "$SSH_DIR/id_ed25519" ]; then
    ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N ""
    echo "SSH key generated at $SSH_DIR/id_ed25519"
  fi

  # Run qc_atomic_station in Docker (Node 20) in the background
  # Uses host networking so port 3000 is accessible externally

  docker run -d \
    --name qc_atomic_station \
    --network=host \
    -v /opt/qc_atomic_station:/app \
    -v /opt/qc_atomic_station/.ssh:/root/.ssh:ro \
    -w /app \
    node:20 \
    bash -c "npm install && npm start"
