#!/bin/bash
# stop the ladder between runs (run_all, ladder_run and their wrapper shell)
for p in $(ps -u $USER -o pid=,args= | awk '/bash run_all.sh|bash ladder_run.sh|PLANS=plans_resume/ || /go.sh/ && !/awk/ {print $1}'); do kill $p; done
