# api
joinmisskey instances' information api

## Environment
2つの環境変数を設定してください。

- `LB_TOKEN`: GitHubのトークン（GitHub情報取得用）
- `MK_TOKEN`: Misskeyのトークン（Misskey投稿用）

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
            langs: String[], //  インスタンスリストでaqzが登録した言語 e.g. ["ja"], ["zh"]
            "description": String | Null,  // meta.description、なければaqzが設定した説明が入るかもしれない
            "isAlive": true, //  稼働中のみ掲載なので、つねにtrue
            value: Number,   //  バージョン等から算定したインスタンスバリュー
            meta: Object,    //  api/metaの結果 ※announcementsは削除されています
            stats: Object,   //  api/statsの結果
            banner: Bool,    //  バナーが存在するかどうか
            background: Bool,//  バックグラウンドイメージがあるかどうか
        }, ...
    ]

}
```

### /instance-banners/instance.host.{jpeg|webp}
軽量化されたインスタンスのバナーが格納されています。

### /instance-backgrounds/instance.host.{jpeg|webp}
軽量化されたインスタンスのバックグラウンドイメージ（ウェルカムページに表示される画像）が格納されています。

### /alives.txt
疎通できたインスタンスのホストのリスト（\n区切り）

### /alives.txt
疎通不能だったインスタンスのホストのリスト（\n区切り）

### versions.json
GitHubから取得した各リポジトリのバージョンリスト
