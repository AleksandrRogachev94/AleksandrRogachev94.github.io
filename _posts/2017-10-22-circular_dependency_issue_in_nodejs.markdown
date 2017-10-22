---
layout: post
title:      "Circular Dependency Issue in NodeJS"
date:       2017-10-22 18:38:04 +0000
permalink:  circular_dependency_issue_in_nodejs
---


It's been a while since I wrote my last post. I had some tough time in startup and was spending all my time, including weekends, working and learning. I'll try to write posts more often. This is a short post, I would like to talk about the issue that I encountered with and about my current solution. I had the following structure: One Parent and many Children that inherit from this Parent (actually, it was some kind of ORM). The idea was to write methods in Parent that would create new instances of children. Parent is an abstract class, it shouldn't be instantiated. The problem for me was to determine inside of Parent which child to instantiate.


My first approach (relatively stupid) was to pass class name as a string to these methods. For this purpose I created Class Factory that takes strings and returns Classes (for example Input - "Child", Output - Child), so you can create new instances from it. The simplified classes structure is presented below.


![schema](https://s3.amazonaws.com/my-docs-bucket/circular-dependency.png)


As you can see,  Child imports Parent, Parent imports Class Factory, Class Factory imports Child. Circle. There is a term for it: Circular Dependency. NodeJS doesn't handle this case. This structure causes some issues. I was receiving very weird errors like `Child extends undefined`. Very subtle error. It took me a lot of time to figure it out. It turned out that NodeJS just doesn't import at least one of all files. It doesn't have 'starting point' in this circle, so to say. So in this case Parent wasn't imported properly and its value was `undefined`. I spent decent amount of time trying to find a solution. It didn't go well. So I decided to choose different, better approach. Actually I realized that I don't need Class Factory at all. I can use `this.constructor` inside of the Parent to instantiate children! `this.constructor`, obviously, refers to 'final' class in my inheritance chain, since it is an instance from which I call these methods.


So my general advise is just try to avoid this situation, refactor your architecture. In most cases this issue can be avoided.
