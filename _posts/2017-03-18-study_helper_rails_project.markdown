---
layout: post
title:  "Study Helper. Rails project."
date:   2017-03-17 22:23:08 -0400
---

![]( http://imgh.us/study_helper2.jpg)

Well, I should say that Rails is awesome. It extremely simplifies our work as developers. Now I understand that Rails is giant comparing to Sinatra framework. It gives us a lot of tools in order to concentrate only on our real tasks.

I was excited about the opportunity of Rails final project in Flatiron school. Well, it was difficult to choose a theme for my app because there is a lot of stuff already implemented on the internet. Finally, I decided to build Study Helper: app for teachers and students. In this application all users can create (and manage) lessons and choose a lesson’s category (physics, math…) from the existing list or create a new one.  By default, all other users can’t see these lessons. But they can make a request (like in facebook) to add them as students. If a teacher accepts this request, student is granted access to his lessons. 

![]( http://imgh.us/schema_studyhelper_1.png)

Take a look at schema of models and their relationships. I decided to make one model for both teachers and students. Every user can study from his teachers and teach to his students. It was interesting to implement self-referential associations. Additional model is needed for that purpose: `Studyship`. Each relation between users is stored in studyships table. Finally, I decided to make the following models associations:

```
class Studyship < ApplicationRecord
  belongs_to :teacher, class_name: "User"
  belongs_to :student, class_name: "User"
  …
end

class User < ApplicationRecord
  …
  # As a student
  has_many :student_teacher_relationships, class_name: "Studyship", foreign_key: 'student_id'
  has_many :teachers, through: :student_teacher_relationships

  # As a teacher
  has_many :teacher_student_relationships, class_name: "Studyship", foreign_key: 'teacher_id'
  has_many :students, through: :teacher_student_relationships
  …
end
```

As a result, User has many Teachers as users and User has many Students as users.

In order to make a request to access user’s materials, request model is implemented. It contains only information about teachers and students which made a request. Only students can make requests to teachers in my app for now. If a teacher accepts request, this request is deleted and new record in studyships table is made.

Regarding controllers, I implemented studyships controller in order to establish connections between users. When user accepts a request, it is studyships controller that takes care of this in `#create` action (same about removing relationships in `#destroy` action). If a user decline a request, destroy action of requests controller handles it.

Authentication system is carried out using `devise` gem. This is really powerful gem which allows us to easily create signin/signup/logout functionality. In my app signing up can be made manually or through facebook account (using OAuth2 protocol). I needed to store more information about users (by default devise uses only email). I realized that this is not the best practice to add fields to users table and handle it modifying devise. So I decided to keep User model only for authentication purposes and to create profile model. User has one Profile and Profile belongs to User. 

In order to authorize users I used `pundit` gem which is great as well. Combination of these 2 tools gives great abilities. I remember how I was struggling in my [recruiting agencies manager]( http://aleksandr-rogachev-blog.com/2017/02/13/sinatra_recruiting_agencies_management/) Sinatra project with authorization. It took quite large amount of time. Pundit really simplifies coding of complex authorization systems. 

By the way (I mentioned Sinatra), I really enjoy concepts of partials and views helpers. It helps keeping the code clean and DRY. Regarding routes, I heavily use nested routes:  Lessons, Profile, and Studyships (students and teachers) are nested inside of the user resources which look logical and RESTful.

I’m pretty happy with the result and my web site looks pretty beautiful too (using bootstrap). I will add some dynamic features using javascript and will deploy it on heroku in my next project!

Now (after completing ruby part at Flatiron school) I need to say that after my story with C++ at the university, I fell in love with Ruby. It is amazingly beautiful and lexical. As for me, it makes programmers happier. Of course it is not as fast and effective as, for example, C++, but it is worth. In web development we do not chase every fraction of a second and do not implement very complex resource-consuming algorithms. Ruby is perfect for its tasks. It allows us to write awesome web apps easily and quickly. Rails, in its turn, makes a lot of magic for us to concentrate on real, actual tasks, not the common ones (like handling HTTP protocol, complex routing and so on, so on, so on). And I love the idea of “convention over configuration”. It is really convenient and saves our time.

Here is the github repo:

[https://github.com/AleksandrRogachev94/study-helper](https://github.com/AleksandrRogachev94/study-helper)

