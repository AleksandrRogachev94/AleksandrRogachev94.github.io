---
layout: post
title:  "Javascript Prototypes and Object Oriented Programming."
date:   2017-04-03 20:35:24 -0400
---

After C++, Java and Ruby, Javascript seems for me a little bit hard to understand. It is different in its core. It is prototype-based object oriented language. In this article I would like to write about it.

In class-based object orientation we must first design the Class, blueprint of an object. And only then we can create objects which will have the same properties as this Class. The Class is a **nonfunctional** structure. On the contrary, the prototype-based object orientation means that we create objects from the other existing, **functional** objects. The difference between these two approaches becomes especially obvious when we talk about inheritance.

First of all, in JS all data are objects. Namely, functions in JS are first class functions (unlike Ruby). They can serve as variables and can be passed as arguments to other functions. So actually they are objects with their own properties and methods. Functions can serve as constructors for new objects:

```
function Dog(name) { this.name = name }
let fido = new Dog(“Fido”)
```

In this example I created `fido` from the `Dog` constructor. As you can see, JS doesn’t use classes as blueprints. It uses real functional functions (if you can say so :) ) to create new objects.

The most important OO concept in javascript is the **Prototype**. Each object in javascript has a prototype stored in __proto__ property. It describes the object from which current object has been created. In the same time, all functions in javascript have prototype property. This property describes properties and methods which will be inherited by new objects when they are created from the corresponding constructor. So in my last example `Dog.prototype === fido.__proto__`. But you can check that this object (prototype) doesn’t contain `name` property. This is because it is not in `Dog`’s prototype. Each object created from this constructor has its own `name` property. We can manually write `name` variable into `Dog`’s prototype:

```
function Dog() {}
Dog.prototype.name = “anonymous”
let fido = new Dog()
let max = new Dog()
fido.name // anonymous
max.name // anonymous
fido.name = “dog”
fido.name // dog
max.name // dog
```

In this case all dogs share the same variable `name`.

Objects in javascript contain methods too. It is not the best practice to declare functions definitions inside constructors. It leads to creation of `n` same function for `n` objects (unfortunately, this is the way Ruby works). We should use the same approach as I used in the last example: create functions directly in prototype. In this case all objects created from `Dog` constructor will share only one function.

* **Inheritance**

In javascript all objects inherit from other objects. The highest node in this chain is `Object.prototype`. All objects eventually inherit from this prototype. Let’s talk about the ways to implement our own inheritance in javascript. The idea is to change prototype of a constructor to be equal to prototype (its copy) of other constructor.
So the classical inheritance schema looks like this:

```
function Animal(legs) { this.legs = legs }
Animal.prototype.sayHi = function() { console.log(“Hi!”) }
function Dog(name) { Animal.call(this, 4); this.name = name }
Dog.prototype = Object.create(Animal.prototype)
Dog.prototype.constructor = Dog
let max = new Dog(“Max”)
max.sayHi() // Hi 
```

As you can see, in this example I use `Object.create(obj.prototype)` function. This function creates a new object with `__proto__` equals to `obj`’s prototype (like `new` operator), but **without calling its constructor**. It’s the main difference between `Object.create` and `new`. This is the correct way to implement inheritance. The old approach is to use `new` operator instead of `Object.create()`. But this way is bad because in this case we create additional **shared** between all instances of `Dog` variables, which is not what we usually want. Also note that we have to manually set constructor to be equal to `Dog` because we’ve completely rewritten `prototype` property and now its constructor is `Animal`. Finally, inheritance chain looks like this:

![]( http://imgh.us/JS_Inheritance.png)

By using `Object.create` we created additional node in our chain (central rectangle) which serves as a prototype for all instances of `Dog` and in its turn has a prototype of `Animal`

Well, as you can see, prototype-based language differs a lot from classical class-oriented. It can be really confusing for the first time. I hope this article was helpful.

