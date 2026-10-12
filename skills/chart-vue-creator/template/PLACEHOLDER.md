# template/ —— 占位（内网资产）

这里应该是内网 fastui 脚手架的模板工程，和 `fastui-vue-creator/template/` **是同一份**。
外网仓不放它的实体（SPEC-DES-001 §8.4）。

## 怎么放

1. 按 SPEC-DES-001 §8.3 的办法把内网脚手架复制进来（排除根目录 `node_modules/`，
   但 `packages/portal/node_modules/` 那 735 字节要保留）。
2. 把 `packages/portal/src/views/_example/index.vue` 换成本 skill `SKILL.md` 硬约束 4 里
   那份 **ECharts golden example**（逐字一致）。这是本 template 与 `fastui-vue-creator/template/`
   唯一允许存在的差异。
3. 删掉本文件。

## ⚠️ `yarn.lock` 必须与 fastui-vue-creator 那份逐字相同

共享依赖池的路径是固定的（`OctoAgent/fastui-env`，不按 skill 区分），而 `ensure-env.mjs`
的主判据是 `template/yarn.lock` 的 sha256 与池子里 `deps/yarn.lock` 的比对。

**两份 lock 只要差一个字节**，设计师用 A skill 时会被判 `ENV_OUTDATED` 刷成 A 的依赖树，
切到 B 又判 `ENV_OUTDATED` 刷回去 —— 每次切 skill 触发一次几分钟的全量升级，来回拉锯，
而且现象看起来像"环境老是坏"，极难归因。

组装后自检：

```bash
shasum -a 256 <文档仓>/skills/fastui-vue-creator/template/yarn.lock \
              <文档仓>/skills/chart-vue-creator/template/yarn.lock
# 两行 hash 必须完全一样
```

改依赖时先想清楚这条:**只要 `yarn.lock` 不变,两份 `package.json` 可以不同**
(`ensure-env` 只比 lock);**一旦改动会让 lock 变,就必须两份 template 一起改**,否则就是上面说的拉锯。
