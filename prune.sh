#!/bin/bash

# data/ignorehosts.ymlのホスト一覧を使ってdata/instances.ymlから削除します
# yqをインストールしておく必要があります

# ignorehosts.ymlからホスト名を読み込む
ignore_hosts=$(yq e '.[]' data/ignorehosts.yml)

# ignore_hostsを"or"で連結する
ignore_hosts_or=$(echo $ignore_hosts | tr ' ' '|')

# ignore_hosts_orを使用してinstances.ymlからホストを削除する
yq e "del(.[] | select(.url | test(\"$ignore_hosts_or\")))" data/instances.yml -i
