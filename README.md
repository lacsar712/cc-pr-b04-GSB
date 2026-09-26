# 印刷套准复核台

接口只把印张偏差放进待处理队列。另一个进程用行锁领走一条，算出套准或套不准后再写回。页面每隔一秒看一次，直到结论出现。

顶栏可开出「印张过滤」专页：提交前缀并保存为命名方案，过滤在服务端做（`GET /api/jobs?prefix=`），列表只返回匹配行，空前缀返回全部。切换方案立即带新前缀重查，不在浏览器藏行。方案可增删，每次变动写入履历；印刷员与质检都能保存方案，删除仅限方案保存人本人，只读账号可应用任意方案并翻履历。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3194 |
| 接口 | http://localhost:8194 |
| PostgreSQL | localhost:54394 |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| printer | print123456 | 可送复核 |
| checker | check123456 | 只看 |

## 启动

```bash
cd projects/15-print-register-review
docker compose up --build
```

## 验收

1. printer 登录后稍等，封面-01 变成套准，内页-09 变成套不准。
2. 再送一条青偏差 0.5 的印张，状态先是待处理，随后变成套不准。
3. checker 没有送复核按钮。

## 印张过滤验收

1. 投封面与内页各一笔，顶栏进「印张过滤」，前缀填「封面」并保存为方案甲，应用后结果表只剩封面行。
2. 应用内置「全部」（空前缀），两行都在。
3. 删掉方案甲，方案履历里同时留有保存与删除两条记录。
4. checker 登录能应用方案、翻履历，但删别人的方案被接口拒绝（403）。

后端接口：`GET/POST /api/filter/schemes`、`DELETE /api/filter/schemes/{id}`（仅保存人）、`GET /api/filter/events`、`GET /api/jobs?prefix=`。验收脚本 `backend/test_filter.py`（需本地 54394 有 PostgreSQL，自建 printreg_test 库）。
