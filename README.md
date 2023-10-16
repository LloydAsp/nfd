# nfd
No Fraud / Node Forward Bot
一个基于cloudflare worker的telegram 消息转发bot，集成了反欺诈功能

## 特点
- 基于cloudflare worker搭建，能够实现以下效果
    - 极低的搭建成本，一个js文件即可完成搭建
    - 不需要额外的域名，利用worker自带域名即可
    - 基于worker kv实现永久数据储存
    - 稳定，全球cdn转发
- 接入反欺诈系统，当聊天对象有诈骗历史时，自动发出提醒


## 欺诈数据源
- 文件[fraud.db](./fraud.db)为欺诈数据，格式为每行一个uid
- 可以通过pr扩展本数据，也可以通过提issue方式补充
- 提供额外欺诈信息时，需要提供一定的消息出处
