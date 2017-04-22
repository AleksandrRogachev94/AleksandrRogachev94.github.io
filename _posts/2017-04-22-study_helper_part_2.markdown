---
layout: post
title:  "Study Helper. Part 2"
date:   2017-04-21 21:15:30 -0400
---


![](http://imgh.us/study_helper2.jpg)

[http://studyhelper.herokuapp.com](http://studyhelper.herokuapp.com)

In the [first part](http://aleksandr-rogachev-blog.com/2017/03/18/study_helper_rails_project/) I’ve written about basic backend functionality of my Rails project. Since then I added some backend functionality and used Javascript to make User Interface more usable and pretty. So this post is divided into two parts: 1) Some New Backend features and 2) Frontend features.

# 1) New Backend features

First of all, I added comments functionality. Each lesson can be commented.  In order to implement authorization to update/delete comments I used `Pundit` gem (actually my app uses Pundit everywhere). Below you can see the authorization rules: 

 

```
Current user can…

Read if he/she is an owner of a lesson or a student of corresponding teacher.

Create if he/she is an owner of a lesson to be commented or a student of corresponding teacher.

Update if he/she is an owner of a comment to be updated.

Delete if he/she is an owner of a comment to be deleted or an owner of the corresponding lesson.
```



Next, now users can upload their photos (avatar) and lessons attachment files (like pdf, doc…). Firstly I implemented it just using `paperlip` - an easy and impressive way to upload/download files in rails.  I decided to store all data in Amazon AWS S3storage, which is, by the way, awesome and gives us free tier for 1 year: 50 GB, 2000 post requests, 10000 get requests per month. Luckily, rails has `aws-sdk` gem to handle connection between rails app and S3. 

Then I realized that it’s not the best practice to upload files into S3 right from the main web process. It blocks server and 1) user should wait until uploading is finished, 2) other users are slowed down or completely stuck (if you use only 1 process with 1 thread). The best way to implement it is to use backgrounds processes: `workers`. One of the approaches is to use `sidekiq` together with `delayed_paperclip` gems. `delayed_paperclip` gem uses `ActiveJob` to create delayed jobs. You just need to specify adapter: in my case `sidekiq`.

After writing `process_in_background :doc` in a model, delayed paperclip will automatically queue (into `redis` DB) the jobs from the client (your web app) to the server (`sidekiq` worker). While deploying (in my case to heroku) the important part of this process it to correctly configure processes, threads and DB pools to work correctly and effectively. It was hard and painful for me (because it is the first time). I will definitely write another blog post about configuring and deploying `delayed_paperclip` + `sidekiq` on puma to heroku.

By the way, it’s still not the most effective way to send files to the storage. Current approach uses the following logic: browser sends file to our server, server processes this file (for instance, resizes it, makes thumb…), and then queues the job for sidekiq. It is still slow with large files. The best way is to send files directly from the client (browser) to storage. Maybe I will try to implement it in my next iteration of improving the Study Helper.

 

# 2) Frontend Javascript features

Finally, let’s talk about Javascript Frontend. This is the fourth project in Flatiron school: add Javascript and jQuery to the rails project. The main purpose is to get very familiar with AJAX. While the process of implementing AJAX loading resources looks relatively clear and simple for me, when it went to the real application it became hard… Actually, each robust (for example, handling all errors and displaying it) AJAX feature requires a lot of efforts, code (comparing to rails tasks), and troubleshooting.

In order to implement AJAX feature, I slightly changed some controller actions, so now they can serve as normal html supplier and as API, meaning rendering html or JSON depending on requests (namely, `accepts` header). In API mode I needed to specify which information about models should be sent to browser. In order to do that I used Active Model Serializer. It allows to specify which parameters should be serialized into JSON, and, furthermore, specify associations. So we use it just like ActiveRecord models: we write has_many, belongs_to… associations and Active Model Serializer automatically serializes corresponding models.

First of all, I implemented fully AJAX read/create/update/destroy actions for comments. It means that now server doesn’t render html formatted comments at all (but is still can). In all actions a page is not reloaded. In order for JS code to know about policies I send them along with comments JSONs themselves (`can_destroy` and `can_update` custom properties). I coded in pure object-oriented style. For example, I have `Comment` “class” (or prototype):



```javascript
function Comment(attributes)  {
  var prop
  for(prop in attributes.comment) {
    this[prop] = attributes.comment[prop]
  }
}
```



Here, `attributes` is a JSON object from the API. I've written almost all methods concerning comments (like rendering, creating templates, attaching event listeners, formatting...) within this class.

Similarly, I've implemented `Lesson` class. My Rails API renders lesson with all its comments (has_many relationship). I decided not to render formatted html lessons and comments from the server at all. When lesson show page is loaded, firstly it is blank. After loading it sends a new `XHR` request for the lesson with its comments. When the browser gets response, it creates html from JSON and **Handlebars** Templates and puts it on the page. So this logic was easily used to implement AJAX next and previous lesson functionality. By the way I think this logic is close to how Rails turbolinks work. And on each lesson page you can create/update/delete comments for this lesson.

Index lessons page was also implemented using AJAX (API responses with lessons grouped by categories). When user clicks lessons button on profile page, the browser send XHR request to the server.

Next, I implemented students requests (index and delete actions) functionality (again, pure OOP style). When user clicks "New Requests" on "My students" page, the browser sends XHR request to the server and then (after getting a response) puts results on the page. When user accepts/declines request, the browser again sends request to the server and when it gets response, it removes request from the page and simultaneously adds new student to "your students" section. 

By default, my web application loads only application.js and application.css files (manifests) without additional app files. I decided to make controller specific loading of the files. So, on lessons page browser gets only application.* and lessons.* (actually, with comments.*, since lesson show page depends on it) assets. It reduces amount of bytes sent with every request and makes things clearer and easier to maintain. 

Concerning deploying the app, I realized that for now assets pipeline (namely, code compressors) doesn’t support ES6. So I had to roll back and rewrite my JS code in ES5 style… I was really disappointed about it and spent some time to figure it out (because I saw really strange errors). If anyone knows an easy way to use ES6 in assets pipeline, please let me know!

Finally, now I have finished, robust (I hope :)) application which is [deployed on heroku](http://studyhelper.herokuapp.com) and ready to use. Hope you enjoyed this article!

P.S. By default, all users signed up via Facebook have Stan (example) as a teacher (so they can view his lessons) to test app.

Here is the github repo:

[https://github.com/AleksandrRogachev94/study-helper-es5](https://github.com/AleksandrRogachev94/study-helper-es5)
