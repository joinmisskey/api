# api
joinmisskey instances' information api

## Endpoints
### /instances.json
インスタンス情報一覧のjsonです。

```
{
    date: Date // instances.json発行日時
    stats: {                      // 統計
        notesCount: Number,       //  総ノート数
        usersCount: Number,       //  総ユーザー数
        instancesCount: Number,   //  稼働インスタンス数
    },
    instancesInfos: [        // インスタンス一覧（※稼働中のみ）
        {
            url: String,     //  ホスト名 e.g. misskey.io
            langs: String[], //  インスタンスリストでaqzが登録した言語 e.g. ["zh", "en"]
            "description": String | Null,  // meta.description、なければaqzが設定した説明が入るかもしれない
            "isAlive": true, //  稼働中のみ掲載なので、つねにtrue
            value: Number,   //  バージョン等から算定したインスタンスバリュー
            meta: Object,    //  api/metaの結果 ※announcementsは削除されています
            stats: Object,   //  api/statsの結果
        }, ...
    ]

}
```

### /instance-banners/instance.host.{jpeg|webp}
軽量化されたインスタンスのバナーが格納されています。
