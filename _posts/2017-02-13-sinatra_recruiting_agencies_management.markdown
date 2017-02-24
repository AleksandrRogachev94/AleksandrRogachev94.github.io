---
layout: post
title:  "Sinatra Recruiting Agencies Management"
date:   2017-02-12 19:35:23 -0500
---

When I finished Sinatra part in Flatiron school, I started to feel the force. Actually this is enough to start building full scale web sites! And I started to make the project… This is my second ruby project within Flatiron school program. The minimum requirements were the following:

1.	Build an MVC Sinatra Application.
2.	User ActiveRecord with Sinatra.
3.	User Multiple Models.
4.	User at least one has_many relationship.
5.	Must have user accounts. The user that created a given piece of content should be the only person who can modify that content.
6.	You should validate user input to ensure that bad data isn’t created.

From the beginning, it was hard for me to choose the theme for my project. It should’ve been an app to manage something. I didn’t want to make something usual and uninteresting. And finally, I decided to create an app that will manage Recruiting agencies. It was tough to connect real life needs with the app. Firstly, I started with 5 models: Agency, Recruiter, Vacancy, Join Table between recruiters and vacancies, and Company. You can log in as agency or as recruiter which is cool. Recruiter can manage his vacancies.

In this context each Agency has multiple recruiters, vacancies through recruiters, and companies through vacancies. Agency can create recruiters so later each recruiter can log in (but they can’t sign up). Each recruiter has many vacancies and each vacancy has many recruiters, but within one agency only one recruiter can deal with certain vacancy. Recruiter has many companies through vacancies. Vacancy belongs to company and company has many vacancies.

 I implemented these models with their associations using ActiveRecord. It is so cool that it allows us to make complex associations with just few lines of code! Of course I didn’t forget about the validations. I made validations both in SQL tables and in ruby models (double check). Then I started to make real web app. I faced with the problem that in current implementation my models are not useful enough for real life!  I decided to make a **Request** model. Recruiter can make a request to his agency in order to close vacancy. Then agency can confirm this request and delete vacancy or decline the request. And finally, agencies share vacancies between each other. Each agency can create its own vacancy or choose from the shared list. To simplify the program for now I deleted Company model and replaced it with 2 fields (company’s name and phone number) in Vacancy model.
I think that the resulting schema looks pretty realistic (see Fig. 1).

![]( http://imgh.us/post5_schema.png)

In my code I follow MVC (model - view - controller) pattern. I have already mentioned the models. Now about controllers: I created 6 controllers to divide responsibilities: `ApplicationController`, `SessionsController`, `AgenciesController`, `RecruitersController`, `VacanciesController` , `RequestsController`. Each of them cares only about corresponding functions.

Authentication and authorization are made carefully. Recruiters can’t do and access anything but creating requests to their agencies. Passwords are not stored in db as they are. I use `bcrypt` gem. It performs cryptographic hash function on passwords and then “salts” the result by adding additional unique for each user random sequence of characters. Note that this algorithm is intentionally slow comparing to the usual fast hash functions such as SHA. It prevents the app from being easily hacked.

 In order to make simple but pretty looking interface I made simple CSS file in `public` directory and used bootstrap. Now its interface looks like shown in Fig. 2.

![]( http://imgh.us/post5_program.png)

My app looks like finished program now. I learned a lot while creating this program and really happy that it works exactly as I wanted. I deployed this app on heroku.



[Site on heroku](https://recruiting-agencies-manager.herokuapp.com)
[Github repo](https://github.com/AleksandrRogachev94/sinatra-recruiting-agencies-management)

