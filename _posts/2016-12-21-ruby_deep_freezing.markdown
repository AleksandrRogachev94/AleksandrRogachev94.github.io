---
layout: post
title:  "Ruby Deep Freezing"
date:   2016-12-21 15:22:24 -0500
---


Hi there! 
As we all know, Ruby Object Class has #freeze method, which prevents an element from further modifications. But generally it doesn’t work for elements which are inside of an origin element (nested elements).
Let’s talk about it a little bit closer. For example, we have a hash: 

```
devices = {
  tv: “Samsung”,
  phones: [“iPhone”, “Samsung”] 
}
```

Strings and Arrays are mutable objects (in opposite to Fixnum or Symbol…). Mutability means that we can change a value without changing a variable that points to this value (its address). In our example variable “phones” is just a reference to the array [“iPhone”, “Samsung”]. “devices” is a hash that contains two variables (:tv and :phones) pointing on mutable objects.

So if we try to write devices.freeze, we will prevent “devices” object from changing. It means that we can’t do anything like

```
devices[:tv] = “LG”
devices[:fridge] = “Whirlpool”.
```

BUT we CAN do the following: 

```
devices[:tv] << “ and LG” 		          # devices[:tv].frozen? --> false
devices[:phones].delete (“Samsung”).		# devices[:phones].frozen? --> false
```

The reason of it is that we don’t modify references of :tv and :phones. But I think that it is sometimes important to prevent all parts of an origin element from modifications too. So we need to dive deeply inside of our objects and freeze every node.

So I have implemented two methods: #deep_freeze and #deep_frozen?. These algorithms are based on recursion. First of all, I iterate over the enumerable nested objects and recursively call #deep_freeze until current object is no more enumerable. Then I iterate over the instance variables of current object and (again) recursively call #deep_freeze until there is no more instance variable. So instance variables can be enumerable again.  At the end of this method I call #freeze on self. #deep_frozen? method has a similar structure. It uses the Boolean flag to trace if there is any nested element that is not freezed.

As a result, #deep_freeze has 2 general functions:

1.	Freezing all objects that are nested inside of the origin object.
2.	Freezing all instance variables which are inside of nested objects.

You can see and use the code in my Github account:
[https://github.com/AleksandrRogachev94/Deep-Freeze](https://github.com/AleksandrRogachev94/Deep-Freeze)

You may notice that I defined these methods in Object class. I know that generally this is bad practice. But in this case I believe it’s worth.

I hope I explained it well enough. Recursion is a hard topic to understand and implement. So it was a good practice for me. Thank you for reading! If you see any mistakes in my explanations I will be happy to listen to you :)

**P.S.**

Please note that this algorithm will not work with objects with relationships, such as “has many” and “belongs to” (you will get stack limit error). I will improve it when I have enough free time. For example, let’s say we have a lot of song objects which belong to one artist and artist has an array of these song objects. When we want to show that array of songs to users in API it’s important to have deep_freeze:

```
class Artist
…
  def song
		@songs.dup.deep_freeze
  end
…
end
```

 In this implementation users will not have any chance to accidentally change any part of the songs array. They can just have a fully freezed copy of the original array. 


