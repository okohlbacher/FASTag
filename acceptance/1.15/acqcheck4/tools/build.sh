#!/bin/bash
# acqcheck4: build FASTag 1.14.0 (git archive v1.14.0) as acqcheck3 built 1.13.4
cd /scratch/kohlbach/acc115/acqcheck4
mkdir -p src && tar -xzf src.tgz -C src
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"; micromamba activate $E
cmake -S src -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$P;$E" > cmake.log 2>&1
ninja -C build -j 12 FASTag > build.log 2>&1; echo "rc=$?" > build.status
mkdir -p opt; cp build/FASTag opt/; sha256sum opt/FASTag > opt.sha256
touch build.done
