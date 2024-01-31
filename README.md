# api
joinmisskey servers' information api

https://instanceapp.misskey.page/instances.json

**This API doesn't follow forks that say `nodeinfo.software.name !== 'misskey'`.**

## Build Environment
You must set following two envs.

- `LB_TOKEN`= GitHub Token (to get versions)
- `MK_TOKEN`= Misskey Token（to post to misskey）

## Endpoints
We are only serving static files via nginx and Cloudflare, so we have no access restrictions.

You can get the following information under https://instanceapp.misskey.page

### /instances.json

```
{
    date: Date // The date instances.json was published at.
    stats: {                      //  statistics
        notesCount: Number,       //  Total notes
        usersCount: Number,       //  Total Users
        mau: Number,              //  Total MAUs
        instancesCount: Number,   //  Servers counter
    },
    langs: String[], // All detected Languages (ISO Codes)
    instancesInfos: [        // Servers Infos (only alives)
        {
            url: String,     //  Hostname e.g. misskey.io
            name: String,    //  Name e.g. すしすきー
            langs: String[], //  Languages (ISO Codes) set manually or detected automatically e.g. ["ja"], ["zh"]
            description: String | Null,  // meta.description or the the API author aqz set manually
            isAlive: true,   //  must true
            value: Number,   //  The server Value calculated from the version, etc.
            banner: Bool,    //  Banner existance
            background: Bool,//  Background Image existance
            icon: Bool,      //  Icon Image existance
            nodeinfo: Object | null,  //  nodeinfo
            meta: Object | null,      //  result of api/meta
            npd15: Number    //  Number of Notes per Day (15-day average)

            stats: Object,   //  deprecated (result of api/stats)
        }, ...
    ]

}
```

### /instance-banners/instance.host.{jpeg|webp}
Banner of each servers (lightweighted)

### /instance-backgrounds/instance.host.{jpeg|webp}
Background image (displayed behind the welcome page) (lightweighted)

### /instance-icons/instance.host.{png|webp}
Icon (not favicon) (lightweighted)

### /alives.txt
List of hosts (separated by `\n`) for servers that were able to communicate

### /deads.txt
List of hosts (separated by `\n`) for servers that were unable to communicate

### versions.json
Version list obtained from GitHub

## Vulnerable servers
Vulnerable servers are not listed in instances.json and are excluded from the server count.

Vulnerability is determined by version; however, if the version has its own pre-release version, there is no vulnerability determination.
