#!/bin/bash
PWD=`grep password= supervisord.conf | awk 'BEGIN{FS="="}{print $2}'`
./supervisord ctl -c supervisord.conf -u enclaved -P ${PWD} $@
