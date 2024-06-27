# NFD修改版
No Fraud / Node Forward Bot

一个基于cloudflare worker的telegram 消息转发bot，集成了反欺诈功能，增加了脏话与广告关键词过滤功能。

## 特点
- 基于cloudflare worker搭建，能够实现以下效果
    - 搭建成本低，一个js文件即可完成搭建
    - 不需要额外的域名，利用worker自带域名即可
    - 基于worker kv实现永久数据储存
    - 稳定，全球cdn转发
- 接入反欺诈系统，当聊天对象有诈骗历史时，自动发出提醒
- 支持屏蔽用户，避免被骚扰
- 支持过滤广告和脏话，触发规则的用户消息不会被转发，且会受到机器人的提示
- 提高自定义便捷度
- 待添加：管理员通过直接向机器人发送特定指令和指定脏话/广告关键词或直接用特定指令回复指定关键词，达成机器人自动添加指定关键词进脏话/广告关键词数据库的功能。（本人能力有限，大概是无望了）

## 搭建方法
1. 从[@BotFather](https://t.me/BotFather)获取token，并且可以发送`/setjoingroups`来禁止此Bot被添加到群组
2. 从[uuidgenerator](https://www.uuidgenerator.net/)获取一个随机uuid作为secret
3. 从[@username_to_id_bot](https://t.me/username_to_id_bot)获取你的用户id
4. 登录[cloudflare](https://workers.cloudflare.com/)，创建一个worker
5. 配置worker的变量
    - 增加一个`ENV_BOT_TOKEN`变量，数值为从步骤1中获得的token
    - 增加一个`ENV_BOT_SECRET`变量，数值为从步骤2中获得的secret
    - 增加一个`ENV_ADMIN_UID`变量，数值为从步骤3中获得的用户id
6. 绑定kv数据库，创建一个Namespace Name为`nfd`的kv数据库，在setting -> variable中设置`KV Namespace Bindings`：nfd -> nfd
7. 点击`Quick Edit`，复制[这个文件](./worker.js)到编辑器中
8. 通过打开`https://xxx.workers.dev/registerWebhook`来注册websoket

## 使用方法
- 当其他用户给bot发消息，会被转发到bot创建者
- 用户回复普通文字给转发的消息时，会回复到原消息发送者
- 用户回复`/block`, `/unblock`, `/checkblock`等命令会执行相关指令，**不会**回复到原消息发送者

## 欺诈数据源
- 文件[fraud.db](./fraud.db)为欺诈数据，格式为每行一个uid
- 可以通过pr扩展本数据，也可以通过提issue方式补充
- 提供额外欺诈信息时，需要提供一定的消息出处

## 以上内容纯属搬运，侵权联系即刻删除。

---
# 此版本为GPT-4o修改版 增加了过滤广告和脏话关键词的功能（支持正则表达式）
## 自定义环境变量
- ENV_AD_WORDS_URL（广告关键词数据库URL 必填）	https://raw.githubusercontent.com/你的github用户名/nfd/main/data/adwords.json
- ENV_ADMIN_UID（TG管理员ID 必填） 你的TG ID
- ENV_BAD_WORDS_URL（脏话关键词数据库URL 必填）	https://raw.githubusercontent.com/你的github用户名/nfd/main/data/badwords.json
- ENV_BOT_SECRET（机器人secret 必填）	你的机器人secret
- ENV_BOT_TOKEN（机器人token 必填）	你的机器人token
- ENV_FRAUD_DB_URL（欺诈者ID数据库URL 必填）	https://raw.githubusercontent.com/你的github用户名/nfd/main/data/fraud.json
- ENV_NOTIFICATION_URL（通知消息URL）	https://raw.githubusercontent.com/你的github用户名/nfd/blob/main/data/notification.txt
- ENV_START_MSG_URL（启动消息URL）	https://raw.githubusercontent.com/你的github用户名/nfd/main/data/startMessage.md
- ENV_GITHUB_API_URL（github仓库API 暂无功能 可以不用添加）	
- ENV_GITHUB_TOKEN（github仓库token 暂无功能 可以不用添加）	

## 鸣谢
- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare "疑似一代源码")
- [原nfd](https://github.com/LloydAsp/nfd "基于此源码利用GPT-4o修改")
- [ChatGPT-4o](https://chatgpt.com/ "修改源码主力")
- [Kimi](https://kimi.moonshot.cn/ "检索资料助手")
- [视频教程：用Cloud flare 搭建一个TG私信机器人 telegram TG双向限制](https://www.youtube.com/watch?v=DBQqj9UwS1M&t=61s "基于源nfd搭建的视频教程")
