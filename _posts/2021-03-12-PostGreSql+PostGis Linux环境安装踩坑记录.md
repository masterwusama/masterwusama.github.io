---
title: PostGreSql+PostGis Linux环境安装踩坑记录
date: 2021-03-12 11:35:00
tags:
- PostGreSql PostGis
description: PostGreSql+PostGis Linux环境安装过程
---
# PostGreSql+PostGis Linux环境安装
---

注:如果PostGreSql和PostGis都是下的最新版本，那<font color=#FF0000 >把系统也升级到最新</font>然后按照[PostGreSql官方教程](https://www.postgresql.org/download/)和[PostGis官方教程](http://postgis.net/install/)应该都能正常安装。

以下是踩坑及相关解决方案

### Compiled without protobuf-c support

```tiki wiki
ERROR: 错误:  ST_AsMVTGeom: Compiled without protobuf-c support
SQL state: XX000
```

和数据库本身没啥关系，需要系统安装一下protobuf-c（1.1.0以上），最好不要用yum装，目前他默认装1.0.0

同时较低版本的Linux，可能不支持1.1.0版本，所以系统直接换到最新可以省很多脑子

以下为PostGis官方扩展安装提示

```tiki wiki
 protobuf-c (Optional, Version 1.1.0 or higher)

  The protobuf-c library and compiler is required for ST_AsMVT and
  ST_AsGeobuf output. Also, pkg-config is required to verify the correct
  minimum version of protobuf-c.

    https://github.com/protobuf-c/protobuf-c
```



### SQL state: 42883

```tiki wiki
HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
SQL state: 42883
```

- 参数类型传错了
- 如果是自定义函数，检查一下申明的时候有没有加public即可

