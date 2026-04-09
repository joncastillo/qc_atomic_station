  #!/bin/bash
  DEVICE=joncastillo@192.168.50.199
  REMOTE=/mnt/sda/opt/qc_atomic_station

  rsync -az --no-group --no-times --inplace --exclude node_modules --exclude dist --exclude .git --exclude env \
    ./ $DEVICE:$REMOTE/

  ssh $DEVICE "bash -l -c '
    docker stop qc_atomic_station 2>/dev/null || true
    docker rm qc_atomic_station 2>/dev/null || true
    bash $REMOTE/start_qc_atomic.sh
  '"
