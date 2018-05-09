---
title: javascript小知识整理(一)闭包
date: 2018-05-09 11:30:58
tags:
- javascript
- 前端
description: js闭包
---

[来源1](http://www.ruanyifeng.com/blog/2009/08/learning_javascript_closures.html)

[来源2](http://www.ruanyifeng.com/blog/2010/04/using_this_keyword_in_javascript.html)

### 从外部读取局部变量

```javascript
function f1(){
  var n=999;

  function f2(){
    return n; // 999
  }
  return f2;
}
var result=f1();

result(); // 999
```
javascript对变量的搜索方式为"链式作用域"结构（chain scope），子对象会一级一级地向上寻找所有父对象的变量。父对象的所有变量，对子对象都是可见的，反之则不成立。

---

# 闭包(closure)

### 1.概念

闭包就是能够读取其他函数内部变量的函数

### 2.用途

1).读取函数内部的变量(局部变量)

2).局部变量不被回收

```javascript
function f1(){
  var n=999;
  nAdd=function(){n+=1}
  function f2(){
    alert(n);
  }
  return f2;
}
var result=f1();
result(); // 999
nAdd();
result(); // 1000
```

- 函数内不使用 var定义的情况下 默认定义为全局变量


- nAdd的值是一个匿名函数（anonymous function），而这个匿名函数本身也是一个闭包，所以nAdd相当于是一个setter，可以在函数外部对函数内部的局部变量进行操作
- f1是f2的父函数，而f2被赋给了一个全局变量，这导致f2始终在内存中，而f2的存在依赖于f1，因此f1也始终在内存中，不会在调用结束后，被垃圾回收机制（garbage collection）回收

### 3.使用注意点

1）由于闭包会使得函数中的变量都被保存在内存中，内存消耗很大，所以不能滥用闭包，否则会造成网页的性能问题，在IE中可能导致内存泄露。解决方法是，在退出函数之前，将不使用的局部变量全部删除。

2）闭包会在父函数外部，改变父函数内部变量的值。所以，如果你把父函数当作对象（object）使用，把闭包当作它的公用方法（Public Method），把内部变量当作它的私有属性（private value），这时一定要小心，不要随便改变父函数内部变量的值。

### 4.this

this指 :调用函数的那个对象

- 最简单的函数内部调用

```javascript
var x = 1;
function test(){
  alert(this.x); //1
  this.x = 0;
}
test();
alert(x); //0
```

通常用法 属于全局调用 此时this代表全局对象Global

- 作为对象方法的调用

```javascript
function test(){
  alert(this.x);
}
var o = {};
o.x = 1;
o.m = test;
o.m(); // 1
```

此时this代表上级对象

- 作为构造函数调用

```javascript
function test(){
  this.x = 1;
}
var o = new test();
alert(o.x); // 1
```

当该函数作为构造函数调用时 

通过这个函数生成一个新对象

此时this代表这个新对象 

- apply/call调用

apply()是函数对象的一个方法，它的作用是改变函数的调用对象，它的第一个参数就表示改变后的调用这个函数的对象。因此，this指的就是这第一个参数

```javascript
var x = 0;
function test(){
  alert(this.x);
}
var o={};
o.x = 1;
o.m = test;
o.m.apply(); //0
o.m.apply(o); //1
```

tips:apply和call的区别(效果一样)

|       | 参数一                  | 参数二             |       |       |      |
| ----- | -------------------- | --------------- | ----- | ----- | ---- |
| apply | 新this对象 `不传则为全局this` | 数组形式的调用方法传入参数列表 |       |       |      |
| call  | 新this对象 `不传则为全局this` | 传入参数1           | 传入参数2 | 传入参数3 | 。。。  |





