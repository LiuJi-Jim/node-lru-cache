;(function () { // closure for web browsers

// 针对window和node.js分别做了一下exports兼容
if (typeof module === 'object' && module.exports) {
  module.exports = LRUCache
} else {
  // just set the global for non-node platforms.
  this.LRUCache = LRUCache
}

// 快捷方式
function hOP (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// 用来作为默认的lengthCalculator
function naiveLength () { return 1 }

// 构造函数
function LRUCache (options) {
  // 兼容无new实例化
  if (!(this instanceof LRUCache))
    return new LRUCache(options)

  // 重载LRUCache(max)构造函数
  if (typeof options === 'number')
    options = { max: options }

  // 重载LRUCache()构造函数
  if (!options)
    options = {}

  this._max = options.max
  // 默认把容量上限计为无限，看起来很奇怪，不过凑合
  // Kind of weird to have a default max of Infinity, but oh well.
  if (!this._max || !(typeof this._max === "number") || this._max <= 0 )
    this._max = Infinity

  // length参数看起来和后面的length属性具有相当大的迷惑性
  // 但其实是用来当做_lengthCalculator
  this._lengthCalculator = options.length || naiveLength
  // 对length参数进行一下规范化
  if (typeof this._lengthCalculator !== "function")
    this._lengthCalculator = naiveLength

  // 一堆参数的规范化
  this._allowStale = options.stale || false
  this._maxAge = options.maxAge || null
  this._dispose = options.dispose
  // 初始化
  this.reset()
}

// 定义一下max属性
// resize the cache when the max changes.
Object.defineProperty(LRUCache.prototype, "max",
  { set : function (mL) {
      // 定义setter
      // 修改max的时候，对容量做一下规范化
      // 如果值不规范，计为无限
      if (!mL || !(typeof mL === "number") || mL <= 0 ) mL = Infinity
      this._max = mL
      // 如果新值大于当前的内容长度，进行一次trim
      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._max }
  , enumerable : true
  })

// 定义lengthCalculator属性
// 它修改的时候，相当于length属性的定义就变了，这时需要重新处理一遍关于容量的属性
// resize the cache when the lengthCalculator changes.
Object.defineProperty(LRUCache.prototype, "lengthCalculator",
  { set : function (lC) {
      // 定义setter
      if (typeof lC !== "function") {
        // 用naiveLength
        // 它的作用是key的长度都标记为1，总长度就是key个数
        this._lengthCalculator = naiveLength
        this._length = this._itemCount
        for (var key in this._cache) {
          this._cache[key].length = 1
        }
      } else {
        // 自定义的lengthCalculator
        this._lengthCalculator = lC
        this._length = 0
        // 每个key运行一遍lengthCaculator，作为其长度
        // 总长度是每个key长度的之和
        for (var key in this._cache) {
          this._cache[key].length = this._lengthCalculator(this._cache[key].value)
          this._length += this._cache[key].length
        }
      }

      // 超过容量了，进行一次trim
      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._lengthCalculator }
  , enumerable : true
  })

// 定义length属性
// 只读
Object.defineProperty(LRUCache.prototype, "length",
  { get : function () { return this._length }
  , enumerable : true
  })

// 定义itemCount属性
// 只读
Object.defineProperty(LRUCache.prototype, "itemCount",
  { get : function () { return this._itemCount }
  , enumerable : true
  })

/**
 * length, lengthCalculator, itemCount和max的关系
 * length是总的长度，可以理解为整个cache空间用掉了多少内存，max是其上限
 * itemCount就是key的个数
 * 每个key所对应的value（载荷），根据缓存对象的类型，会体现出不同的length
 * 比如整数，就可以简单地当做1，而字符串、Buffer这类的，可以用其length来体现内存占用
 * lengthCalculator定义了每个缓存元素的长度如何计算
 * 这样的话可以稍微更精确一点控制内存
 */

// 定义forEach迭代器
LRUCache.prototype.forEach = function (fn, thisp) {
  thisp = thisp || this
  var i = 0;
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    i++
    var hit = this._lruList[k]
    if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
      del(this, hit)
      if (!this._allowStale) hit = undefined
    }
    if (hit) {
      fn.call(thisp, hit.value, hit.key, this)
    }
  }
}

// keys方法
// 返回所有key
LRUCache.prototype.keys = function () {
  var keys = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    keys[i++] = hit.key
  }
  return keys
}

// values方法
// 返回所有value
LRUCache.prototype.values = function () {
  var values = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    values[i++] = hit.value
  }
  return values
}

// 清空
LRUCache.prototype.reset = function () {
  // 如果定义了析构函数，那么对每个value执行一次析构函数
  if (this._dispose && this._cache) {
    for (var k in this._cache) {
      this._dispose(k, this._cache[k].value)
    }
  }

  // 把_cache和_lruList都重置
  // 用Object.create(null)来创建一个新的Plain Object
  // 相比直接`{}`有什么好处呢？看这里 https://github.com/isaacs/node-lru-cache/pull/23
  // _cache是实际用于缓存的k-v字典
  this._cache = Object.create(null) // hash of items by key
  // _lruList是LRU栈
  // 用了字典而非数组，猜测原因：
  // 栈顶和栈底指针是严格递增的，并且没有遍历需要
  // 虽然索引是整数，但严格意义来说它依然只是个key而已
  // 用数组的话，随着时间推移，会不断浪费栈底以下的那部分数组空间
  // 虽然我还是觉得用双链表更合适吧，不过这样实现起来容易太多了
  this._lruList = Object.create(null) // list of items in order of use recency
  // _mru是最近最多使用，相当于栈顶指针
  this._mru = 0 // most recently used
  // _lru是最近最少使用，相当于栈底指针
  this._lru = 0 // least recently used
  // 重置_length, _itemCount为0
  this._length = 0 // number of items in the list
  this._itemCount = 0
}

// Provided for debugging/dev purposes only. No promises whatsoever that
// this API stays stable.
LRUCache.prototype.dump = function () {
  return this._cache
}

LRUCache.prototype.dumpLru = function () {
  return this._lruList
}

// 核心API之一
LRUCache.prototype.set = function (key, value) {
  // 如果key已经在缓存里的话
  if (hOP(this._cache, key)) {
    // 覆写之前，先析构旧的值
    // dispose of the old one before overwriting
    if (this._dispose) this._dispose(key, this._cache[key].value)
    // 如果设置了maxAge的话，要给计个时
    if (this._maxAge) this._cache[key].now = Date.now()
    // 存之
    this._cache[key].value = value
    // 利用get来维护一下LRU结构
    this.get(key)
    return true
  }

  // 否则它是一个新插入的缓存
  // 先计算占用的长度
  var len = this._lengthCalculator(value)
  // 如果设置了maxAge的话，给计个时
  var age = this._maxAge ? Date.now() : 0
  // 直接放在栈顶
  /**
   * hit其实是一个简单Plain Object {
   *   key,
   *   value,
   *   lu, // 这个对象在栈里的索引
   *   length,
   *   age
   * }
   */
  // 直接构造没问题的，但是为了帮助V8做hidden type优化，把它定义成了一个类（好赞……）
  var hit = new Entry(key, value, this._mru++, len, age)

  // 如果长度比整个容量还大，那肯定是缓存不了的
  // oversized objects fall out of cache automatically.
  if (hit.length > this._max) {
    // 需要执行一下析构函数
    if (this._dispose) this._dispose(key, value)
    return false
  }

  // 维护length属性
  this._length += hit.length
  // 维护lru表，最新的一个肯定就是栈顶
  // 将缓存对象放入_cache
  this._lruList[hit.lu] = this._cache[key] = hit
  // 维护itemCount
  this._itemCount ++

  // 如果总占用长度超过了上限，trim一下
  if (this._length > this._max) trim(this)
  return true
}

// 核心API之一
LRUCache.prototype.has = function (key) {
  // 不在缓存，妥妥儿的是没有
  if (!hOP(this._cache, key)) return false
  var hit = this._cache[key]
  // 在缓存里，但是有设置maxAge，并且距离其上次使用的时间也已经超过了maxAge
  // 意味着其生命周期已结束
  // 也算是失败了
  if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
    return false
  }
  return true
}

// 核心API之一，这个实现放在下面的
LRUCache.prototype.get = function (key) {
  return get(this, key, true)
}

// 功能和get差不多，但并不会更新它的`recently used`属性
LRUCache.prototype.peek = function (key) {
  return get(this, key, false)
}

// 获取LRU并且删掉之
LRUCache.prototype.pop = function () {
  var hit = this._lruList[this._lru]
  del(this, hit)
  return hit || null
}

// 删
LRUCache.prototype.del = function (key) {
  del(this, this._cache[key])
}

// get的实现
// doUse表示是否要更新`recently used`信息
function get (self, key, doUse) {
  var hit = self._cache[key]
  if (hit) {
    if (self._maxAge && (Date.now() - hit.now > self._maxAge)) {
      // 过期的，删
      del(self, hit)
      // 如果设置了stale=true，那么会在删除的时候给它一次回光返照的机会
      // 否则就当它不存在
      if (!self._allowStale) hit = undefined
    } else {
      // 维护`recently used`信息
      if (doUse) use(self, hit)
    }
    // 只返回缓存载荷，附加信息不返回
    if (hit) hit = hit.value
  }
  return hit
}

// 维护`recently used`信息
function use (self, hit) {
  // 把hit从栈里摘出来，并且维护栈底
  shiftLU(self, hit)
  // 把hit放到栈顶，维护栈顶
  hit.lu = self._mru ++
  self._lruList[hit.lu] = hit
}

// trim
// 遍历删除栈底，直到占用空间不再超限
function trim (self) {
  while (self._lru < self._mru && self._length > self._max)
    del(self, self._lruList[self._lru])
}

// 两个作用：
// 1、把hit从栈里摘出来
// 2、重新遍历，寻找新的栈底
function shiftLU (self, hit) {
  // 从栈里摘出来
  delete self._lruList[ hit.lu ]
  // 重新遍历，寻找新的栈底
  while (self._lru < self._mru && !self._lruList[self._lru]) self._lru ++
}

// 删删删
function del (self, hit) {
  if (hit) {
    // 调用析构函数先
    if (self._dispose) self._dispose(hit.key, hit.value)
    // 计算length和itemCount
    self._length -= hit.length
    self._itemCount --
    // 删之
    delete self._cache[ hit.key ]
    // 把hit从栈里摘出来
    shiftLU(self, hit)
  }
}

// 上面介绍了这个用途
// classy, since V8 prefers predictable objects.
function Entry (key, value, lu, length, now) {
  this.key = key
  this.value = value
  this.lu = lu
  this.length = length
  this.now = now
}

})()