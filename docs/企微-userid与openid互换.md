# userid与openid互换 - 文档 - 企业微信开发者中心

该接口使用场景为企业支付，在使用企业红包和向员工付款时，需要自行将企业微信的userid转成openid。

注：需要成员使用微信登录企业微信或者关注微信插件（原企业号）才能转成openid;  
如果是外部联系人，请使用[外部联系人openid转换](https://developer.work.weixin.qq.com/document/path/90202#18820)转换openid

**请求方式：**POST（**HTTPS**）  
**请求地址：** https://qyapi.weixin.qq.com/cgi-bin/user/convert\_to\_openid?access\_token=ACCESS\_TOKEN

**请求示例：**

```javascript
{
   "userid": "zhangsan"
}
```

**参数说明：**

| 参数 | 必须 | 说明 |
| --- | --- | --- |
| access\_token | 是 | 调用接口凭证 |
| userid | 是 | 企业内的成员id |

**权限说明：**  
成员必须处于应用的可见范围内

**返回结果 ：**

```javascript
{
   "errcode": 0,
   "errmsg": "ok",
   "openid": "oDjGHs-1yCnGrRovBj2yHij5JAAA"
}
```

**参数说明 ：**

| 参数 | 说明 |
| --- | --- |
| errcode | 返回码 |
| errmsg | 对返回码的文本描述内容 |
| openid | 企业微信成员userid对应的openid |

## [](https://developer.work.weixin.qq.com/document/path/90202#openid%E8%BD%ACuserid)openid转userid

该接口主要应用于使用企业支付之后的结果查询。  
开发者需要知道某个结果事件的openid对应企业微信内成员的信息时，可以通过调用该接口进行转换查询。

**请求方式：**POST（**HTTPS**）  
**请求地址：** https://qyapi.weixin.qq.com/cgi-bin/user/convert\_to\_userid?access\_token=ACCESS\_TOKEN

**请求示例：**

```javascript
{
   "openid": "oDjGHs-1yCnGrRovBj2yHij5JAAA"
}
```

**参数说明：**

| 参数 | 必须 | 说明 |
| --- | --- | --- |
| access\_token | 是 | 调用接口凭证 |
| openid | 是 | 在使用企业支付之后，返回结果的openid |

**权限说明：**  
管理组需对openid对应的企业微信成员有查看权限。

**返回结果 ：**

```javascript
{
   "errcode": 0,
   "errmsg": "ok",
   "userid": "zhangsan"
}
```

**参数说明 ：**

| 参数 | 说明 |
| --- | --- |
| errcode | 返回码 |
| errmsg | 对返回码的文本描述内容 |
| userid | 该openid在企业微信对应的成员userid |